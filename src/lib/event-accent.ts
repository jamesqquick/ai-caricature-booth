export function eventAccentForeground(accentColor: string) {
  const channels = [1, 3, 5].map((index) => Number.parseInt(accentColor.slice(index, index + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance >= 0.179 ? '#000000' : '#ffffff';
}
