/**
 * Media file helpers shared between the main-stage picker and the drawer.
 */

export const VIDEO_FILE_INPUT_ATTR =
  'video/mp4,video/webm,video/ogg,video/quicktime,.mkv,.avi,.flv,.mp4,.webm,.mov';
export const AUDIO_FILE_INPUT_ATTR =
  'audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/aac,audio/x-m4a,audio/m4a,audio/ogg,audio/flac,.mp3,.m4a,.aac,.wav,.ogg,.oga,.flac,.opus';

/** Combined input accept attr: the file input with `multiple` doesn't filter by
 *  file picker on every browser — we re-classify via detectKind() after. */
export const MEDIA_FILE_INPUT_ATTR = `${VIDEO_FILE_INPUT_ATTR},${AUDIO_FILE_INPUT_ATTR}`;

const AUDIO_EXT_RE = /\.(mp3|m4a|aac|wav|ogg|oga|flac|opus)$/;

/**
 * Detect media kind from a filename. Defaults to 'video'.
 *
 * Also used for downloaded files, where there is no `File` object — only a
 * name — so the extension list lives here rather than inside `detectKind`.
 */
export function mediaKindFromName(filename: string): 'video' | 'audio' {
  return AUDIO_EXT_RE.test(filename.toLowerCase()) ? 'audio' : 'video';
}

/** Detect media kind from a File. Defaults to 'video'. */
export function detectKind(file: File): 'video' | 'audio' {
  const mime = file.type.toLowerCase();
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  // Fallback to extension when MIME is empty (some browsers).
  return mediaKindFromName(file.name);
}
