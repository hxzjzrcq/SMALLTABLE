/** Validate MPEG Layer III frame structure and derive duration from frame sample counts.
 * No player report is trusted. VBR is supported; malformed/truncated frames are rejected.
 * ID3v2 and optional ID3v1 tags are metadata, not audio duration.
 */
export function inspectMp3(data: Buffer) {
  let offset = 0,
    end = data.length,
    duration = 0,
    frames = 0;
  if (data.subarray(0, 3).toString() === 'ID3') {
    if (
      data.length < 10 ||
      ![2, 3, 4].includes(data[3]) ||
      data[4] === 255 ||
      [...data.subarray(6, 10)].some((n) => n > 127)
    )
      throw Error('无效 ID3 标记');
    const size = data[6] * 2097152 + data[7] * 16384 + data[8] * 128 + data[9];
    offset = 10 + size + (data[3] === 4 && data[5] & 16 ? 10 : 0);
    if (offset > end) throw Error('ID3 内容截断');
  }
  if (end >= 128 && data.subarray(end - 128, end - 125).toString() === 'TAG') end -= 128;
  while (offset < end) {
    if (offset + 4 > end) throw Error('MP3 帧截断');
    const h = data.readUInt32BE(offset);
    const version = (h >>> 19) & 3,
      layer = (h >>> 17) & 3;
    const rateIndex = (h >>> 12) & 15,
      sampleIndex = (h >>> 10) & 3;
    if (
      h >>> 21 !== 2047 ||
      version === 1 ||
      layer !== 1 ||
      rateIndex === 0 ||
      rateIndex === 15 ||
      sampleIndex === 3 ||
      (h & 3) === 2
    )
      throw Error('内容不是有效 MP3');
    const rates =
      version === 3
        ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
        : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    const sampleRate =
      [44100, 48000, 32000][sampleIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const size =
      Math.floor(((version === 3 ? 144000 : 72000) * rates[rateIndex]) / sampleRate) +
      ((h >>> 9) & 1);
    if (offset + size > end || size < 4) throw Error('MP3 帧截断');
    duration += (version === 3 ? 1152 : 576) / sampleRate;
    frames++;
    offset += size;
  }
  if (frames < 2) throw Error('MP3 音频帧不足');
  return { duration };
}
