interface ZoomControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export function ZoomControls({ zoom, onZoomIn, onZoomOut }: ZoomControlsProps) {
  const zoomPercent = Math.round(zoom * 100);

  return (
    <div className="zoom-controls">
      <button
        className="zoom-btn"
        onClick={onZoomOut}
        disabled={zoom <= 0.03125}
        title="Zoom out (-)"
      >
        -
      </button>
      <span className="zoom-level">{zoomPercent}%</span>
      <button
        className="zoom-btn"
        onClick={onZoomIn}
        disabled={zoom >= 1}
        title="Zoom in (+)"
      >
        +
      </button>
    </div>
  );
}
