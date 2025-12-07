import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { Readable, PassThrough } from 'stream';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFile, unlink, readFile } from 'fs/promises';
import { generateId } from '../utils/helpers.js';

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegStatic);

/**
 * Process incoming audio input and convert to format suitable for transcription
 * @param {Buffer} audioBuffer - Raw audio buffer
 * @param {string} mimeType - MIME type of the audio
 * @returns {Promise<Buffer>} - Processed audio buffer
 */
export async function processAudioInput(audioBuffer, mimeType = 'audio/webm') {
  const inputPath = join(tmpdir(), `input_${generateId()}.audio`);
  const outputPath = join(tmpdir(), `output_${generateId()}.mp3`);

  try {
    console.log(`[AudioProcessor] Processing ${audioBuffer.length} bytes of ${mimeType}`);
    await writeFile(inputPath, audioBuffer);

    await new Promise((resolve, reject) => {
      const ffmpegCmd = ffmpeg(inputPath)
        .audioCodec('libmp3lame')
        .audioChannels(1)
        .audioFrequency(16000)
        .audioBitrate('64k')
        .format('mp3')
        .on('end', () => {
          console.log('[AudioProcessor] FFmpeg conversion completed');
          resolve();
        })
        .on('error', (err) => {
          console.error('[AudioProcessor] FFmpeg conversion error:', err.message);
          reject(err);
        });

      // Add input format hint for WAV files
      if (mimeType === 'audio/wav') {
        ffmpegCmd.inputFormat('wav');
      }

      ffmpegCmd.save(outputPath);
    });

    const processedBuffer = await readFile(outputPath);
    console.log(`[AudioProcessor] Conversion successful - output: ${processedBuffer.length} bytes`);

    // Cleanup temp files
    await Promise.all([
      unlink(inputPath).catch(() => {}),
      unlink(outputPath).catch(() => {})
    ]);

    return processedBuffer;
  } catch (error) {
    console.error('[AudioProcessor] Processing failed:', error);
    // Cleanup on error
    await Promise.all([
      unlink(inputPath).catch(() => {}),
      unlink(outputPath).catch(() => {})
    ]);
    throw error;
  }
}

/**
 * Process a single audio chunk from streaming input
 * @param {Buffer} chunk - Audio chunk
 * @returns {Promise<Buffer>} - Processed chunk
 */
export async function processAudioChunk(chunk) {
  // For streaming, we collect chunks as-is and process when complete
  return chunk;
}

/**
 * Finalize audio stream by concatenating and processing all chunks
 * @param {Buffer[]} chunks - Array of audio chunks
 * @returns {Promise<Buffer>} - Final processed audio buffer
 */
export async function finalizeAudioStream(chunks) {
  if (chunks.length === 0) {
    throw new Error('No audio chunks to process');
  }

  const combinedBuffer = Buffer.concat(chunks);
  console.log(`[AudioProcessor] Finalizing audio stream - ${chunks.length} chunks, ${combinedBuffer.length} bytes total`);

  // Check if the audio is WAV format (from VAD) or WebM (from web/browser)
  const isWav = combinedBuffer.length >= 4 &&
                combinedBuffer.toString('ascii', 0, 4) === 'RIFF';

  const mimeType = isWav ? 'audio/wav' : 'audio/webm';
  console.log(`[AudioProcessor] Detected format: ${mimeType}`);

  return processAudioInput(combinedBuffer, mimeType);
}

/**
 * Convert audio buffer to a readable stream
 * @param {Buffer} buffer - Audio buffer
 * @returns {Readable} - Readable stream
 */
export function bufferToStream(buffer) {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}

/**
 * Create a pass-through stream for audio processing
 * @returns {PassThrough} - PassThrough stream
 */
export function createAudioStream() {
  return new PassThrough();
}

/**
 * Get audio duration in seconds
 * @param {Buffer} audioBuffer - Audio buffer
 * @returns {Promise<number>} - Duration in seconds
 */
export async function getAudioDuration(audioBuffer) {
  const inputPath = join(tmpdir(), `duration_${generateId()}.audio`);

  try {
    await writeFile(inputPath, audioBuffer);

    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        unlink(inputPath).catch(() => {});

        if (err) {
          reject(err);
          return;
        }

        resolve(metadata.format.duration || 0);
      });
    });
  } catch (error) {
    await unlink(inputPath).catch(() => {});
    throw error;
  }
}
