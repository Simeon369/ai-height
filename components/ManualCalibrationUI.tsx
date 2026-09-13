'use client';

import React, { useRef, useState, useEffect } from 'react';
import { CheckCircle2, ZoomIn, ZoomOut, Maximize } from 'lucide-react';

interface Point {
  x: number;
  y: number;
}

interface ManualCalibrationUIProps {
  imageSrc: string;
  referenceSizeCm: number;
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
  const imageRef = useRef<HTMLImageElement | null>(null);
  
  // High-performance refs (bypass React state for 60fps dragging/zooming)
  const pointsRef = useRef<Point[]>([]);
  const activeIdxRef = useRef<number | null>(null);
  
  // Viewport transforms
  const zoomRef = useRef<number>(1);
  const offsetRef = useRef<Point>({ x: 0, y: 0 });
  const isPanningRef = useRef<boolean>(false);
  const lastPanTouchRef = useRef<Point | null>(null);
  const initialPinchDistRef = useRef<number | null>(null);
  
  const [isReady, setIsReady] = useState(false);

  // Load image
  useEffect(() => {
    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
      imageRef.current = img;
      
      // Initialize points in center
      if (containerRef.current) {
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        const scale = Math.min(w / img.width, h / img.height);
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        
        // Start with a box in the center of the image (relative to image native size)
        const boxW = img.width * 0.4;
        const boxH = boxW * (5.398 / 8.56); // ATM card ratio
        const cx = img.width / 2;
        const cy = img.height / 2;

        pointsRef.current = [
          { x: cx - boxW / 2, y: cy - boxH / 2 }, // TL
          { x: cx + boxW / 2, y: cy - boxH / 2 }, // TR
          { x: cx + boxW / 2, y: cy + boxH / 2 }, // BR
          { x: cx - boxW / 2, y: cy + boxH / 2 }, // BL
        ];
        
        setIsReady(true);
      }
    };
  }, [imageSrc]);

  // Main render loop
  useEffect(() => {
    if (!isReady || !imageRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let frameId: number;
    const draw = () => {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const img = imageRef.current!;
      const baseScale = Math.min(canvas.width / img.width, canvas.height / img.height);
      const totalScale = baseScale * zoomRef.current;
      
      const drawW = img.width * totalScale;
      const drawH = img.height * totalScale;
      
      // Center offset + pan offset
      const cx = (canvas.width - drawW) / 2 + offsetRef.current.x;
      const cy = (canvas.height - drawH) / 2 + offsetRef.current.y;

      // Draw Image
      ctx.drawImage(img, cx, cy, drawW, drawH);

      // Helper to convert image coords to screen coords
      const toScreen = (p: Point) => ({
        x: cx + p.x * totalScale,
        y: cy + p.y * totalScale,
      });

      const screenPoints = pointsRef.current.map(toScreen);

      // Draw polygon
      ctx.beginPath();
      ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
      for (let i = 1; i < 4; i++) {
        ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(200, 139, 61, 0.2)';
      ctx.fill();
      ctx.strokeStyle = '#C88B3D';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw corner points
      screenPoints.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
        ctx.fillStyle = activeIdxRef.current === i ? '#E85D2C' : '#C88B3D';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      });

      // Draw Loupe if dragging
      if (activeIdxRef.current !== null) {
        const pScreen = screenPoints[activeIdxRef.current];
        const pImg = pointsRef.current[activeIdxRef.current];
        
        const loupeRadius = 50;
        const zoomLevel = 2.5; // Loupe zoom
        const loupeOffset = -90; 

        let lx = pScreen.x;
        let ly = pScreen.y + loupeOffset;
        if (ly - loupeRadius < 0) ly = pScreen.y - loupeOffset; 

        ctx.save();
        ctx.beginPath();
        ctx.arc(lx, ly, loupeRadius, 0, Math.PI * 2);
        ctx.clip(); 

        ctx.fillStyle = '#000';
        ctx.fill();
        
        const srcW = (loupeRadius * 2) / zoomLevel / totalScale;
        const srcH = (loupeRadius * 2) / zoomLevel / totalScale;
        const srcX = pImg.x - srcW / 2;
        const srcY = pImg.y - srcH / 2;
        
        ctx.drawImage(
          img,
          srcX, srcY, srcW, srcH,
          lx - loupeRadius, ly - loupeRadius, loupeRadius * 2, loupeRadius * 2
        );
        
        ctx.strokeStyle = '#C88B3D';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(lx - 8, ly);
        ctx.lineTo(lx + 8, ly);
        ctx.moveTo(lx, ly - 8);
        ctx.lineTo(lx, ly + 8);
        ctx.stroke();
        
        ctx.restore();

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
  }, [isReady]);

  // Interaction handlers
  const getTouchDist = (t1: React.Touch, t2: React.Touch) => 
    Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

  const getScreenToImage = (x: number, y: number) => {
    const img = imageRef.current!;
    const canvas = canvasRef.current!;
    const baseScale = Math.min(canvas.width / img.width, canvas.height / img.height);
    const totalScale = baseScale * zoomRef.current;
    const cx = (canvas.width - (img.width * totalScale)) / 2 + offsetRef.current.x;
    const cy = (canvas.height - (img.height * totalScale)) / 2 + offsetRef.current.y;
    return {
      x: (x - cx) / totalScale,
      y: (y - cy) / totalScale,
    };
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 2) {
      initialPinchDistRef.current = getTouchDist(e.touches[0], e.touches[1]);
      activeIdxRef.current = null;
      return;
    }
    
    if (e.touches.length === 1) {
      const rect = canvasRef.current!.getBoundingClientRect();
      const tx = e.touches[0].clientX - rect.left;
      const ty = e.touches[0].clientY - rect.top;
      
      const img = imageRef.current!;
      const baseScale = Math.min(rect.width / img.width, rect.height / img.height);
      const totalScale = baseScale * zoomRef.current;
      const cx = (rect.width - (img.width * totalScale)) / 2 + offsetRef.current.x;
      const cy = (rect.height - (img.height * totalScale)) / 2 + offsetRef.current.y;

      // Find if we touched a point
      let closestIdx = -1;
      let minDist = 40; // hit radius
      pointsRef.current.forEach((p, i) => {
        const sx = cx + p.x * totalScale;
        const sy = cy + p.y * totalScale;
        const dist = Math.hypot(sx - tx, sy - ty);
        if (dist < minDist) {
          minDist = dist;
          closestIdx = i;
        }
      });

      if (closestIdx !== -1) {
        activeIdxRef.current = closestIdx;
      } else {
        isPanningRef.current = true;
        lastPanTouchRef.current = { x: tx, y: ty };
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    
    if (e.touches.length === 2 && initialPinchDistRef.current !== null) {
      const dist = getTouchDist(e.touches[0], e.touches[1]);
      const delta = dist / initialPinchDistRef.current;
      zoomRef.current = Math.min(Math.max(1, zoomRef.current * delta), 10);
      initialPinchDistRef.current = dist;
      return;
    }

    if (e.touches.length === 1) {
      const tx = e.touches[0].clientX - rect.left;
      const ty = e.touches[0].clientY - rect.top;

      if (activeIdxRef.current !== null) {
        const imgP = getScreenToImage(tx, ty);
        pointsRef.current[activeIdxRef.current] = imgP;
      } else if (isPanningRef.current && lastPanTouchRef.current) {
        const dx = tx - lastPanTouchRef.current.x;
        const dy = ty - lastPanTouchRef.current.y;
        offsetRef.current.x += dx;
        offsetRef.current.y += dy;
        lastPanTouchRef.current = { x: tx, y: ty };
      }
    }
  };

  const handleTouchEnd = () => {
    activeIdxRef.current = null;
    isPanningRef.current = false;
    initialPinchDistRef.current = null;
    lastPanTouchRef.current = null;
  };

  const handleConfirm = () => {
    if (!imageRef.current || !containerRef.current) return;
    
    // Find longest edge in native image pixels
    let maxDistPx = 0;
    for (let i = 0; i < 4; i++) {
      const p1 = pointsRef.current[i];
      const p2 = pointsRef.current[(i + 1) % 4];
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      if (dist > maxDistPx) {
        maxDistPx = dist;
      }
    }

    // cmPerPixel = real size / pixel size
    const cmPerPixel = referenceSizeCm / maxDistPx;
    onConfirm(cmPerPixel);
  };

  const handleZoomIn = () => { zoomRef.current = Math.min(zoomRef.current * 1.5, 10); };
  const handleZoomOut = () => { zoomRef.current = Math.max(zoomRef.current / 1.5, 1); };
  const handleResetZoom = () => { zoomRef.current = 1; offsetRef.current = { x: 0, y: 0 }; };

  return (
    <div className="absolute inset-0 bg-black z-50 flex flex-col">
      <div className="bg-[#141110] px-5 py-4 border-b border-[#2A2521] flex justify-between items-center z-10">
        <div>
          <h3 className="text-[#F2EEE4] text-sm font-semibold">Align the Card</h3>
          <p className="text-[#8B8478] text-xs mt-1">Pinch to zoom. Drag outside the corners to pan.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleZoomOut} className="p-2 bg-[#2A2521] rounded text-[#F2EEE4]"><ZoomOut className="w-4 h-4" /></button>
          <button onClick={handleResetZoom} className="p-2 bg-[#2A2521] rounded text-[#F2EEE4]"><Maximize className="w-4 h-4" /></button>
          <button onClick={handleZoomIn} className="p-2 bg-[#2A2521] rounded text-[#F2EEE4]"><ZoomIn className="w-4 h-4" /></button>
        </div>
      </div>

      <div 
        ref={containerRef}
        className="flex-1 relative overflow-hidden touch-none"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>

      <div className="bg-[#141110] px-5 pt-4 pb-6 border-t border-[#2A2521] flex gap-3 z-10">
        <button onClick={onCancel} className="flex-1 py-3 text-sm font-medium text-[#8B8478]">Cancel</button>
        <button onClick={handleConfirm} className="flex-1 py-3 text-sm font-semibold flex items-center justify-center gap-2 bg-[#C88B3D] text-[#141110] rounded">
          <CheckCircle2 className="w-4 h-4" />
          Confirm
        </button>
      </div>
    </div>
  );
}
