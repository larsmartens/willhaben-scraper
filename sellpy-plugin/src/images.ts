import type { ItemObservation, ReferenceImage, RequestContext } from './domain.js';
import { ToolError } from './domain.js';
import { allowedUpstreamURL, readBounded } from './http.js';

export function imageMime(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if ([137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) return 'image/png';
  if (new TextDecoder().decode(bytes.slice(0,4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8,12)) === 'WEBP') return 'image/webp';
  return null;
}

export function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) text += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(text);
}

export interface DeliveredImage {
  id: string;
  index: number;
  url: string;
  status: 'ready' | 'failed' | 'pending';
  mime_type?: string;
  error?: ReturnType<ToolError['toJSON']>;
}

export interface ImageBatch {
  item_id: string;
  images: DeliveredImage[];
  next_index: number | null;
  remaining_indices: number[];
  failed_indices: number[];
  total_images: number;
  pixel_bytes: number;
  contents: { type: 'image'; data: string; mimeType: string }[];
  hydration: Record<string,string>;
  delivered_ids: string[];
}

export async function loadImages(item: ItemObservation, start: number, count: number, context: RequestContext, options: { for_model: boolean; byte_budget?: number } = { for_model: true }): Promise<ImageBatch> {
  const images = item.images.filter(image => image.index >= start).sort((a,b) => a.index-b.index);
  const result: ImageBatch = { item_id:item.id, images:[], next_index:null, remaining_indices:[], failed_indices:[], total_images:item.images.length,
    pixel_bytes:0, contents:[], hydration:{}, delivered_ids:[] };
  const budget = options.byte_budget ?? 6 * 1024 * 1024;
  let encodedBytes = 0;
  let attempted = 0;
  for (const image of images) {
    if (attempted >= count || Date.now() + 150 >= context.deadline) {
      result.remaining_indices.push(image.index);
      continue;
    }
    attempted++;
    try {
      allowedUpstreamURL(image.url);
      const response = await context.fetch(image.url, { headers: { Accept:'image/jpeg,image/png,image/webp' } });
      if (!response.ok) throw new ToolError('image_unavailable', `Image request returned ${response.status}.`, { retryable:response.status >= 500 });
      const bytes = await readBounded(response, 6 * 1024 * 1024);
      const mime = imageMime(bytes);
      if (!mime) throw new ToolError('invalid_image', 'This response is not a supported JPEG, PNG or WebP image.');
      const expectedEncoded = Math.ceil(bytes.length / 3) * 4;
      if (encodedBytes + expectedEncoded > budget) {
        if (result.images.some(entry => entry.status === 'ready')) {
          result.remaining_indices.push(image.index);
          attempted = count;
          continue;
        }
        throw new ToolError('image_too_large', 'This original image exceeds the current response byte budget.', {
          next_action: 'Open the original image URL or inspect another available view. Other images remain reachable.'
        });
      }
      const data = toBase64(bytes);
      encodedBytes += data.length;
      result.pixel_bytes += bytes.length;
      result.images.push({ id:image.id,index:image.index,url:image.url,status:'ready',mime_type:mime });
      if (options.for_model) {
        result.contents.push({ type:'image',data,mimeType:mime });
        result.delivered_ids.push(image.id);
      } else result.hydration[image.id] = `data:${mime};base64,${data}`;
    } catch (error) {
      const failure = error instanceof ToolError ? error : new ToolError('image_fetch_failed', 'The image could not be fetched.', { retryable:true });
      result.images.push({ id:image.id,index:image.index,url:image.url,status:'failed',error:failure.toJSON() });
      result.failed_indices.push(image.index);
      if (failure.code === 'time_budget' || failure.code === 'rate_limited') {
        result.remaining_indices.push(image.index);
        attempted = count;
      }
    }
  }
  result.remaining_indices = [...new Set(result.remaining_indices)].sort((a,b)=>a-b);
  result.next_index = result.remaining_indices[0] ?? null;
  return result;
}

export async function prepareReference(reference: ReferenceImage, context: RequestContext): Promise<{ bytes: Uint8Array; mime_type: string; file_name: string }> {
  const url = allowedUpstreamURL(reference.download_url);
  const response = await context.fetch(url.toString());
  if (!response.ok) throw new ToolError('reference_unavailable', `The uploaded reference returned ${response.status}.`, {
    retryable: response.status >= 500, next_action:'Attach the reference image again if its download link expired.'
  });
  const bytes = await readBounded(response, 10 * 1024 * 1024);
  const mime = imageMime(bytes);
  if (!mime) throw new ToolError('unsupported_reference', 'Upload a JPEG, PNG or WebP reference image.');
  return { bytes, mime_type:mime, file_name:(reference.file_name ?? `reference.${mime.split('/')[1]}`).replace(/[\x00-\x1f/\\]/g,'_') };
}
