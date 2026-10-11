type Point = { x: number; y: number };
// Monotone cubic interpolation preserves measured peaks and never invents overshoot.
export function smoothPath(points: Point[]): string {
  if (!points.length) return "";
  const p = (n: number) => n.toFixed(2);
  let path = `M ${p(points[0].x)} ${p(points[0].y)}`;
  if (points.length === 1) return path;
  const slopes = points
    .slice(1)
    .map((v, i) => (v.y - points[i].y) / (v.x - points[i].x));
  const tangents = points.map((_, i) =>
    i === 0
      ? slopes[0]
      : i === points.length - 1
        ? slopes.at(-1)!
        : slopes[i - 1] * slopes[i] <= 0
          ? 0
          : (slopes[i - 1] + slopes[i]) / 2,
  );
  slopes.forEach((s, i) => {
    if (s === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      return;
    }
    const a = tangents[i] / s,
      b = tangents[i + 1] / s,
      h = Math.hypot(a, b);
    if (h > 3) {
      tangents[i] = (3 * a * s) / h;
      tangents[i + 1] = (3 * b * s) / h;
    }
  });
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i],
      b = points[i + 1],
      dx = (b.x - a.x) / 3;
    path += ` C ${p(a.x + dx)} ${p(a.y + dx * tangents[i])} ${p(b.x - dx)} ${p(b.y - dx * tangents[i + 1])} ${p(b.x)} ${p(b.y)}`;
  }
  return path;
}
