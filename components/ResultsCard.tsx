'use client';

import React from 'react';
import { type MeasurementResult } from '@/lib/measurements';
import { Ruler, MoveHorizontal, ArrowUpFromLine, RotateCcw, Share2 } from 'lucide-react';

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

export default function ResultsCard({ results, onRetake }: ResultsCardProps) {
  const measurements = [
    {
      label: 'Height',
      value: results.heightCm,
      imperial: cmToFeetInches(results.heightCm),
      icon: <Ruler className="w-5 h-5" />,
      color: 'from-blue-500 to-cyan-400',
      bgColor: 'bg-blue-500/10',
      borderColor: 'border-blue-500/20',
    },
    {
      label: 'Wingspan',
      value: results.wingspanCm,
      imperial: cmToFeetInches(results.wingspanCm),
      icon: <MoveHorizontal className="w-5 h-5" />,
      color: 'from-violet-500 to-purple-400',
      bgColor: 'bg-violet-500/10',
      borderColor: 'border-violet-500/20',
    },
    {
      label: 'Standing Reach',
      value: results.standingReachCm,
      imperial: cmToFeetInches(results.standingReachCm),
      icon: <ArrowUpFromLine className="w-5 h-5" />,
      color: 'from-amber-500 to-orange-400',
      bgColor: 'bg-amber-500/10',
      borderColor: 'border-amber-500/20',
    },
  ];

  const wingspanToHeight = results.heightCm > 0
    ? (results.wingspanCm / results.heightCm).toFixed(2)
    : '—';

  const handleShare = async () => {
    const text = `My Measurements:\n📏 Height: ${results.heightCm} cm (${cmToFeetInches(results.heightCm)})\n🦅 Wingspan: ${results.wingspanCm} cm (${cmToFeetInches(results.wingspanCm)})\n🙋 Standing Reach: ${results.standingReachCm} cm (${cmToFeetInches(results.standingReachCm)})\n\nMeasured with AI Body Measure`;

    if (navigator.share) {
      try {
        await navigator.share({ text });
      } catch {
        // User cancelled
      }
    } else {
      await navigator.clipboard.writeText(text);
      alert('Results copied to clipboard!');
    }
  };

  return (
    <div className="flex flex-col min-h-full bg-zinc-950">
      {/* Header */}
      <div className="pt-12 pb-6 px-6 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/10 border border-green-500/20 mb-4">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-green-400 text-xs font-medium">Measurement Complete</span>
        </div>
        <h2 className="text-2xl font-bold text-white mb-1">Your Results</h2>
        <p className="text-zinc-400 text-sm">AI-powered body measurements</p>
      </div>

      {/* Measurement cards */}
      <div className="flex-1 px-4 space-y-3">
        {measurements.map((m) => (
          <div
            key={m.label}
            className={`relative overflow-hidden rounded-2xl border ${m.borderColor} ${m.bgColor} p-5`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-xl bg-gradient-to-br ${m.color} text-white`}>
                  {m.icon}
                </div>
                <div>
                  <p className="text-zinc-400 text-xs font-medium uppercase tracking-wider">
                    {m.label}
                  </p>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-3xl font-bold text-white">{m.value}</span>
                    <span className="text-zinc-400 text-sm">cm</span>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <span className="text-lg font-semibold text-zinc-300">{m.imperial}</span>
              </div>
            </div>
          </div>
        ))}

        {/* Wingspan-to-Height ratio */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-zinc-400 text-xs font-medium uppercase tracking-wider">
                Wingspan / Height Ratio
              </p>
              <p className="text-zinc-500 text-xs mt-0.5">
                (NBA average: ~1.06)
              </p>
            </div>
            <span className="text-2xl font-bold text-white">{wingspanToHeight}</span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 py-6 space-y-3">
        <button
          onClick={handleShare}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-white text-zinc-900 text-sm font-semibold transition-all hover:bg-zinc-100 active:scale-[0.98]"
        >
          <Share2 className="w-4 h-4" />
          Share Results
        </button>
        <button
          onClick={onRetake}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-zinc-800 text-zinc-300 text-sm font-medium transition-colors hover:bg-zinc-700"
        >
          <RotateCcw className="w-4 h-4" />
          Retake Measurements
        </button>
      </div>
    </div>
  );
}
