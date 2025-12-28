interface CoordinateDisplayProps {
  x: number;
  y: number;
}

export function CoordinateDisplay({ x, y }: CoordinateDisplayProps) {
  return (
    <div className="coordinate-display">
      <span className="coord-label">X:</span>
      <span className="coord-value">{Math.round(x)}</span>
      <span className="coord-label">Y:</span>
      <span className="coord-value">{Math.round(y)}</span>
    </div>
  );
}
