'use client';

import React, { useRef, useState, useEffect } from 'react';
import { CheckCircle2 } from 'lucide-react';

interface Point {
  x: number;
  y: number;
}

interface ManualCalibrationUIProps {
  imageSrc: string;
  referenceSizeCm: number; // For ATM, we use the longest edge (8.56)
  onConfirm: (cmPerPixel: number) => void;
  onCancel: () => void;
}

export default function ManualCalibrationUI({
  imageSrc,
  referenceSizeCm,
  onConfirm,
  onCancel,
}: ManualCalibrationUIProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [activePointIdx, setActivePointIdx] = useState<number | null>(null);
  
  // Load image
  useEffect(() => {
    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
      setImage(img);
    };
  }, [imageSrc]);

  // Initialize points in the center once image loads
  useEffect(() => {
    if (image && containerRef.current && points.length === 0) {
      const container = containerRef.current;
      const w = container.clientWidth;
      const h = container.clientHeight;
      
      // Calculate image draw dimensions (object-fit: contain)
      const scale = Math.min(w / image.width, h / image.height);
      const drawW = image.width * scale;
      const drawH = image.height * scale;
      const offsetX = (w - drawW) / 2;
      const offsetY = (h - drawH) / 2;

      // Start with a box in the center of the image
      const boxW = drawW * 0.4;
      const boxH = boxW * (5.398 / 8.56); // ATM card ratio
      const cx = offsetX + drawW / 2;
      const cy = offsetY + drawH / 2;

      setPoints([
        { x: cx - boxW / 2, y: cy - boxH / 2 }, // TL
        { x: cx + boxW / 2, y: cy - boxH / 2 }, // TR
        { x: cx + boxW / 2, y: cy + boxH / 2 }, // BR
        { x: cx - boxW / 2, y: cy + boxH / 2 }, // BL
      ]);
    }
  }, [image, points.length]);

  // Main render loop
  useEffect(() => {
    if (!image || points.length !== 4) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let frameId: number;
    const draw = () => {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw the frozen frame (contain)
      const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
      const drawW = image.width * scale;
      const drawH = image.height * scale;
      const offsetX = (canvas.width - drawW) / 2;
      const offsetY = (canvas.height - drawH) / 2;
      ctx.drawImage(image, offsetX, offsetY, drawW, drawH);

      // Draw polygon and lines
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < 4; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(200, 139, 61, 0.2)';
      ctx.fill();
      ctx.strokeStyle = '#C88B3D';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw corner points
      points.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.fillStyle = activePointIdx === i ? '#E85D2C' : '#C88B3D';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      });

      // Draw Loupe if dragging
      if (activePointIdx !== null) {
        const p = points[activePointIdx];
        const loupeRadius = 45;
        const zoomScale = 2.5;
        const loupeOffset = -80; // Offset above the finger

        // Ensure loupe stays on screen
        let lx = p.x;
        let ly = p.y + loupeOffset;
        if (ly - loupeRadius < 0) ly = p.y - loupeOffset; // Flip below if too high

        ctx.save();
        ctx.beginPath();
        ctx.arc(lx, ly, loupeRadius, 0, Math.PI * 2);
        ctx.clip(); // Clip to circle

        // Draw zoomed portion
        // First clear the clipped area with solid black to hide background
        ctx.fillStyle = '#000';
        ctx.fill();
        
        // Map touch point back to original image coords
        const imgX = (p.x - offsetX) / scale;
        const imgY = (p.y - offsetY) / scale;
        
        // Draw the zoomed image source
        // Source region:
        const srcW = (loupeRadius * 2) / zoomScale / scale;
        const srcH = (loupeRadius * 2) / zoomScale / scale;
        const srcX = imgX - srcW / 2;
        const srcY = imgY - srcH / 2;
        
        ctx.drawImage(
          image,
          srcX, srcY, srcW, srcH,
          lx - loupeRadius, ly - loupeRadius, loupeRadius * 2, loupeRadius * 2
        );
        
        // Draw crosshair in loupe
        ctx.strokeStyle = '#C88B3D';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(lx - 5, ly);
        ctx.lineTo(lx + 5, ly);
        ctx.moveTo(lx, ly - 5);
        ctx.lineTo(lx, ly + 5);
        ctx.stroke();
        
        ctx.restore();

        // Draw loupe border
        ctx.beginPath();
        ctx.arc(lx, ly, loupeRadius, 0, Math.PI * 2);
        ctx.strokeStyle = '#E85D2C';
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      frameId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(frameId);
  }, [image, points, activePointIdx]);

  // Touch handlers
  const handlePointerDown = (e: React.PointerEvent) => {
    if (points.length !== 4) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Find closest point within touch radius
    let closestIdx = -1;
    let minDist = 30; // 30px hit radius
    points.forEach((p, i) => {
      const dist = Math.hypot(p.x - x, p.y - y);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = i;
      }
    });

    if (closestIdx !== -1) {
      setActivePointIdx(closestIdx);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (activePointIdx === null || points.length !== 4) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    // Allow dragging outside slightly, but clamp to canvas bounds
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

    setPoints((prev) => {
      const next = [...prev];
      next[activePointIdx] = { x, y };
      return next;
    });
  };

  const handlePointerUp = () => {
    setActivePointIdx(null);
  };

  const handleConfirm = () => {
    if (points.length !== 4 || !image || !containerRef.current) return;
    
    // Calculate scale from view to image
    const container = containerRef.current;
    const scale = Math.min(container.clientWidth / image.width, container.clientHeight / image.height);

    // Find the longest edge (we assume user aligns longest edge to 8.56cm)
    let maxDistViewPx = 0;
    for (let i = 0; i < 4; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % 4];
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      if (dist > maxDistViewPx) {
        maxDistViewPx = dist;
      }
    }

    // Convert view pixels to actual image pixels
    const maxDistImagePx = maxDistViewPx / scale;

    // cmPerPixel (in actual image space)
    const pixelsPerCm = maxDistImagePx / referenceSizeCm;
    const cmPerPixel = 1 / pixelsPerCm;
    
    onConfirm(cmPerPixel);
  };

  return (
    <div className="absolute inset-0 bg-black z-50 flex flex-col">
      <div className="bg-[#141110] px-5 py-4 border-b border-[#2A2521] shadow-lg z-10">
        <h3 className="text-[#F2EEE4] text-sm font-semibold">Align the Card</h3>
        <p className="text-[#8B8478] text-xs mt-1">
          Drag the 4 corners to perfectly outline the ATM card. The magnifier will help you be precise.
        </p>
      </div>

      <div 
        ref={containerRef}
        className="flex-1 relative overflow-hidden touch-none cursor-crosshair"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <canvas
          ref={canvasRef}
          className="w-full h-full block"
        />
      </div>

      <div className="bg-[#141110] px-5 pt-4 pb-6 border-t border-[#2A2521] flex gap-3 z-10">
        <button
          onClick={onCancel}
          className="flex-1 py-3 text-sm font-medium"
          style={{ color: '#8B8478' }}
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          className="flex-1 py-3 text-sm font-semibold flex items-center justify-center gap-2 rounded transition-opacity active:opacity-80"
          style={{ background: '#C88B3D', color: '#141110' }}
        >
          <CheckCircle2 className="w-4 h-4" />
          Confirm
        </button>
      </div>
    </div>
  );
}
