'use client';

import React, { useState } from 'react';
import MeasureFlow from '@/components/MeasureFlow';
import ResultsCard from '@/components/ResultsCard';
import { type MeasurementResult } from '@/lib/measurements';

export default function MeasurePage() {
  const [step, setStep] = useState<'measure' | 'results'>('measure');
  const [results, setResults] = useState<MeasurementResult | null>(null);

  const handleComplete = (measurement: MeasurementResult) => {
    setResults(measurement);
    setStep('results');
  };

  const handleRetake = () => {
    setResults(null);
    setStep('measure');
  };

  return (
    <div className="h-screen h-dvh flex flex-col overflow-hidden bg-black">
      {step === 'measure' && (
        <MeasureFlow
          onComplete={handleComplete}
          onBack={() => window.history.back()}
        />
      )}

      {step === 'results' && results && (
        <ResultsCard results={results} onRetake={handleRetake} />
      )}
    </div>
  );
}
