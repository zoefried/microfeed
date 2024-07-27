import { JsonResponseBuilder } from "../common/PageUtils";
import { STATUSES } from "../../common-src/Constants";
import { getIdFromSlug } from "../../common-src/StringUtils";
import { S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { projectPrefix } from "../../common-src/R2Utils";

//
// Fetch feed / item json
//

export async function onFetchFeedJsonRequestGet({ env, request }, checkIsAllowed = true) {
  const jsonResponseBuilder = new JsonResponseBuilder(env, request, {
    queryKwargs: {
      status: STATUSES.PUBLISHED,
    },
  });
  return await jsonResponseBuilder.getResponse({ checkIsAllowed });
}

export async function onFetchItemRequestGet({ params, env, request }, checkIsAllowed = true, statuses = null) {
  const { slug, itemId } = params;
  const theItemId = itemId || getIdFromSlug(slug);

  if (theItemId) {
    const jsonResponseBuilder = new JsonResponseBuilder(env, request, {
      queryKwargs: {
        id: theItemId,
        'status__in': statuses || [STATUSES.PUBLISHED, STATUSES.UNLISTED],
      },
      limit: 1,
    });

     // Fetch all items
     console.log('Starting to build allItemsResponse');
     const allItemsResponseBuilder = new JsonResponseBuilder(env, request, {
       queryKwargs: {
         status: STATUSES.PUBLISHED,
       },
     });
     console.log('Built allItemsResponseBuilder:', allItemsResponseBuilder);
     const allItemsResponse = await allItemsResponseBuilder.getResponse({ checkIsAllowed });
     console.log('Got allItemsResponse:', allItemsResponse);
     
     let allItems;
     if (allItemsResponse instanceof Response) {
       const jsonData = await allItemsResponse.json();
     //  console.log('jsonData from index.jsx:', jsonData);
       allItems = jsonData.items;
   //    console.log('allItems from index.jsx:', allItems);
     }
     
     // Check if allItems is defined and is an array
     if (!Array.isArray(allItems)) {
       console.log('allItems is not an array:', allItems);
       return JsonResponseBuilder.Response404();
     }
     
     // Find the requested item, the previous item, and the next item
     const itemIndex = allItems.findIndex(item => item.id === theItemId);
     
     // Check if the item was found
     if (itemIndex === -1) {
       console.log('Item not found in allItems:', theItemId);
       return JsonResponseBuilder.Response404();  // Item not found
     }

    // Get the next and previous items
    const nextItem = allItems[itemIndex + 1];
    const prevItem = allItems[itemIndex - 1];

    // Set the next and previous item links
    const next_item_link = nextItem ? `/items/${nextItem.id}` : null;
    const prev_item_link = prevItem ? `/items/${prevItem.id}` : null;


    return jsonResponseBuilder.getResponse({
      isValid: (jsonData) => {
        const item = jsonData.items && jsonData.items.length > 0 ? jsonData.items[0] : null;
        if (!item) {
          return false;
        }

        // Add the next and previous item links to the current item
        item.next_item_link = next_item_link;
        item.prev_item_link = prev_item_link;

        return true;
      },
      checkIsAllowed,
    });
  }

  return JsonResponseBuilder.Response404();
}

//
// Fetch presigned url from R2
//

async function getPresignedUrlFromR2(env, bucket, inputParams) {
  const { key } = inputParams;
  const accessKeyId = `${env.R2_ACCESS_KEY_ID}`;
  const secretAccessKey = `${env.R2_SECRET_ACCESS_KEY}`;
  const endpoint = `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const region = "auto"; // Use appropriate region

  const s3Client = new S3Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    endpoint,
  });

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: `${projectPrefix(env)}/${key}`,
  });

  const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
  return presignedUrl;
}

/**
 * inputParams is a json:
 * {
 *   "key": "images/item-472d74ac4df2bedd120dd49dd83c7e44.png"
 * }
 *
 * "key" format:
 * - Cover image: images/item-<uuid4>.<ext>
 * - Media image: media/image-<uuid4>.<ext>
 * - Media audio: media/audio-<uuid4>.<ext>
 * - Media video: media/video-<uuid4>.<ext>
 * - Media document: media/document-<uuid4>.<ext>
 *
 * Response json:
 * {
 *   "presignedUrl": "<full-presigned-url>?X-Amz-Expires=86400&...",
 *   "mediaBaseUrl": "<pages-project-name>>/<environment>"
 * }
 */
export async function onGetR2PresignedUrlRequestPost({ inputParams, env }) {
  const presignedUrl = await getPresignedUrlFromR2(env, env.R2_PUBLIC_BUCKET, inputParams);
  return {
    presignedUrl,
    mediaBaseUrl: projectPrefix(env),
  };
}
