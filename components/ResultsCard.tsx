'use client';

import React, { useState, useEffect, useRef } from 'react';
import { type MeasurementResult } from '@/lib/measurements';
import { RotateCcw, Share2, ChevronDown, ChevronUp } from 'lucide-react';

interface ResultsCardProps {
  results: MeasurementResult;
  onRetake: () => void;
}

function cmToFeetInches(cm: number): string {
  const totalInches = cm / 2.54;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches % 12);
  return `${feet}'${inches}"`;
}

function useCountUp(target: number, duration = 800): number {
  const [value, setValue] = useState(0);
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current || target === 0) return;
    hasRun.current = true;

    const steps = 40;
    const stepDuration = duration / steps;
    let current = 0;
    const increment = target / steps;

    const timer = setInterval(() => {
      current = Math.min(current + increment, target);
      setValue(Math.round(current * 10) / 10);
      if (current >= target) clearInterval(timer);
    }, stepDuration);

    return () => clearInterval(timer);
  }, [target, duration]);

  return value;
}

export default function ResultsCard({ results, onRetake }: ResultsCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const displayHeight = useCountUp(results.heightCm);

  const wingspanRatio = results.wingspanCm && results.heightCm > 0
    ? (results.wingspanCm / results.heightCm)
    : null;

  const handleShare = async () => {
    let text = `Measured with Apex\n\nHeight: ${results.heightCm} cm (${cmToFeetInches(results.heightCm)})`;
    if (results.wingspanCm) text += `\nWingspan: ${results.wingspanCm} cm (${cmToFeetInches(results.wingspanCm)})`;
    if (results.standingReachCm) text += `\nStanding Reach: ${results.standingReachCm} cm (${cmToFeetInches(results.standingReachCm)})`;
    if (wingspanRatio) text += `\nWingspan ratio: ${wingspanRatio.toFixed(2)}x height`;

    if (navigator.share) {
      try { await navigator.share({ text }); } catch { /* cancelled */ }
    } else {
      await navigator.clipboard.writeText(text);
    }
  };

  return (
    <div
      className="flex flex-col min-h-full overflow-y-auto"
      style={{ background: '#141110', color: '#F2EEE4' }}
    >
      <div className="flex-1 px-6 pt-12 pb-6 max-w-md mx-auto w-full">

        {/* Small label */}
        <p className="text-xs mb-3" style={{ color: '#8B8478' }}>Measurement complete</p>

        {/* Primary numeral readout */}
        <div
          className="flex items-end gap-3 mb-1"
          style={{ borderBottom: '1px solid #2A2521', paddingBottom: '1.25rem' }}
        >
          <span
            className="font-tabular leading-none"
            style={{ fontSize: 'clamp(4rem, 22vw, 6rem)', fontWeight: 900, color: '#F2EEE4' }}
          >
            {displayHeight}
          </span>
          <div className="pb-2 flex gap-4 items-baseline">
            <span className="text-sm" style={{ color: '#8B8478' }}>cm</span>
            <span
              className="font-tabular text-xl font-bold"
              style={{ borderLeft: '1px solid #2A2521', paddingLeft: '1rem', color: '#8B8478' }}
            >
              {cmToFeetInches(results.heightCm)}
            </span>
          </div>
        </div>

        {/* Additional measurements (if captured) */}
        {(results.wingspanCm || results.standingReachCm) && (
          <div className="mt-0" style={{ borderBottom: '1px solid #2A2521' }}>
            {results.wingspanCm && (
              <>
                <div className="flex items-center justify-between py-3.5">
                  <span className="text-sm" style={{ color: '#8B8478' }}>Wingspan</span>
                  <div className="flex items-baseline gap-3">
                    <span className="font-tabular font-bold text-base" style={{ color: '#F2EEE4' }}>
                      {results.wingspanCm} cm
                    </span>
                    <span className="text-sm" style={{ color: '#8B8478' }}>
                      {cmToFeetInches(results.wingspanCm)}
                    </span>
                  </div>
                </div>
                <div style={{ height: '1px', background: '#2A2521' }} />
              </>
            )}
            {results.standingReachCm && (
              <div className="flex items-center justify-between py-3.5">
                <span className="text-sm" style={{ color: '#8B8478' }}>Standing Reach</span>
                <div className="flex items-baseline gap-3">
                  <span className="font-tabular font-bold text-base" style={{ color: '#F2EEE4' }}>
                    {results.standingReachCm} cm
                  </span>
                  <span className="text-sm" style={{ color: '#8B8478' }}>
                    {cmToFeetInches(results.standingReachCm)}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Combine context — wingspan ratio */}
        {wingspanRatio && (
          <div
            className="my-5 pl-3 py-1"
            style={{ borderLeft: '2px solid #C88B3D' }}
          >
            <p className="text-sm leading-snug" style={{ color: '#F2EEE4' }}>
              Wingspan ratio:{' '}
              <span className="font-tabular font-bold" style={{ color: '#C88B3D' }}>
                {wingspanRatio.toFixed(2)}×
              </span>{' '}
              height
            </p>
            <p className="text-xs mt-0.5" style={{ color: '#8B8478' }}>
              NBA combine average is 1.03×. Elite wingspan begins at 1.07×.
            </p>
          </div>
        )}

        {/* Calibration diagnostics — collapsed */}
        <div style={{ borderTop: '1px solid #2A2521', marginTop: wingspanRatio ? 0 : '1.25rem' }}>
          <button
            id="calibration-details-toggle"
            onClick={() => setDetailsOpen((v) => !v)}
            className="flex items-center justify-between w-full py-3.5 text-left"
          >
            <span className="text-sm" style={{ color: '#8B8478' }}>Calibration details</span>
            {detailsOpen
              ? <ChevronUp className="w-4 h-4" style={{ color: '#8B8478' }} />
              : <ChevronDown className="w-4 h-4" style={{ color: '#8B8478' }} />
            }
          </button>

          {detailsOpen && (
            <div style={{ borderTop: '1px solid #2A2521' }}>
              <div className="flex items-center justify-between py-3">
                <span className="text-xs" style={{ color: '#8B8478' }}>Reference object</span>
                <span className="font-tabular text-xs font-medium" style={{ color: '#F2EEE4' }}>Size 7 ball — 24.1 cm</span>
              </div>
              <div style={{ height: '1px', background: '#2A2521' }} />
              <div className="flex items-center justify-between py-3">
                <span className="text-xs" style={{ color: '#8B8478' }}>Detected diameter</span>
                <span className="font-tabular text-xs font-medium" style={{ color: '#F2EEE4' }}>
                  {results.ballDiameterPx ? `${results.ballDiameterPx} px` : '—'}
                </span>
              </div>
              <div style={{ height: '1px', background: '#2A2521' }} />
              <div className="flex items-center justify-between py-3">
                <span className="text-xs" style={{ color: '#8B8478' }}>Scale ratio</span>
                <span className="font-tabular text-xs font-medium" style={{ color: '#F2EEE4' }}>
                  {results.cmPerPixel ? `${results.cmPerPixel} cm/px` : '—'}
                </span>
              </div>
            </div>
          )}
        </div>

      </div>

      {/* Action bar */}
      <div
        className="px-6 py-5 flex gap-3 max-w-md mx-auto w-full"
        style={{ borderTop: '1px solid #2A2521' }}
      >
        <button
          id="share-results-btn"
          onClick={handleShare}
          className="flex items-center justify-center gap-2 flex-1 py-3.5 text-sm font-medium transition-opacity active:opacity-70"
          style={{ color: '#8B8478' }}
        >
          <Share2 className="w-4 h-4" />
          Share
        </button>
        <button
          id="retake-measurements-btn"
          onClick={onRetake}
          className="flex items-center justify-center gap-2 flex-1 py-3.5 text-sm font-semibold transition-opacity active:opacity-80"
          style={{ background: '#C88B3D', color: '#141110', borderRadius: '4px' }}
        >
          <RotateCcw className="w-4 h-4" />
          Retake
        </button>
      </div>
    </div>
  );
}
