'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { REFERENCE_OBJECTS, type ReferenceObject } from '@/lib/measurements';
import { ChevronDown } from 'lucide-react';

export default function Home() {
  const [selectedRefId, setSelectedRefId] = useState<string>(REFERENCE_OBJECTS[0].id);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const selectedRef = REFERENCE_OBJECTS.find(r => r.id === selectedRefId) || REFERENCE_OBJECTS[0];

  return (
    <div className="flex flex-col min-h-screen" style={{ background: '#141110', color: '#F2EEE4' }}>
      <main className="flex-1 flex flex-col px-6 pt-14 pb-10 max-w-md mx-auto w-full">

        {/* Wordmark */}
        <div className="mb-2 flex flex-col items-center w-full text-center">
          <h1
            className="font-tabular leading-none tracking-tight"
            style={{ fontSize: 'clamp(3.5rem, 18vw, 5.5rem)', fontWeight: 900, color: '#F2EEE4' }}
          >
            Apex
          </h1>
          <p className="mt-2 text-sm leading-snug" style={{ color: '#8B8478' }}>
            Measure like the combine does.
          </p>
        </div>

        {/* Diagram */}
        <div className="my-8 flex justify-center">
          <svg
            viewBox="0 0 220 320"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="w-full max-w-[220px]"
            aria-label="Diagram showing a person standing next to a basketball with a height measurement line"
          >
            {/* Floor line */}
            <line x1="20" y1="298" x2="200" y2="298" stroke="#2A2521" strokeWidth="1" />

            {/* Height measurement line */}
            <line x1="42" y1="28" x2="42" y2="298" stroke="#C88B3D" strokeWidth="1" strokeDasharray="3 3" />
            {/* Top tick */}
            <line x1="36" y1="28" x2="48" y2="28" stroke="#C88B3D" strokeWidth="1.5" />
            {/* Bottom tick */}
            <line x1="36" y1="298" x2="48" y2="298" stroke="#C88B3D" strokeWidth="1.5" />
            {/* Label */}
            <text x="28" y="168" fill="#C88B3D" fontSize="9" fontFamily="monospace" textAnchor="middle" transform="rotate(-90 28 168)">HEIGHT</text>

            {/* Person — stick figure with proportions */}
            <circle cx="130" cy="43" r="16" stroke="#F2EEE4" strokeWidth="1.2" strokeOpacity="0.5" />
            <line x1="130" y1="59" x2="130" y2="70" stroke="#F2EEE4" strokeWidth="1.2" strokeOpacity="0.5" />
            <line x1="104" y1="78" x2="156" y2="78" stroke="#F2EEE4" strokeWidth="1.2" strokeOpacity="0.5" />
            <line x1="130" y1="78" x2="130" y2="172" stroke="#F2EEE4" strokeWidth="1.2" strokeOpacity="0.5" />
            <line x1="104" y1="78" x2="99" y2="148" stroke="#F2EEE4" strokeWidth="1.2" strokeOpacity="0.5" />
            <line x1="156" y1="78" x2="161" y2="148" stroke="#F2EEE4" strokeWidth="1.2" strokeOpacity="0.5" />
            <line x1="116" y1="172" x2="144" y2="172" stroke="#F2EEE4" strokeWidth="1.2" strokeOpacity="0.5" />
            <line x1="119" y1="172" x2="113" y2="298" stroke="#F2EEE4" strokeWidth="1.2" strokeOpacity="0.5" />
            <line x1="141" y1="172" x2="147" y2="298" stroke="#F2EEE4" strokeWidth="1.2" strokeOpacity="0.5" />

            {/* Basketball circle */}
            <circle cx="178" cy="282" r="16" stroke="#F2EEE4" strokeWidth="1.2" strokeOpacity="0.5" />
            {/* Ball seams */}
            <path d="M163 282 Q178 275 193 282" stroke="#F2EEE4" strokeWidth="0.7" strokeOpacity="0.4" fill="none" />
            <path d="M163 282 Q178 289 193 282" stroke="#F2EEE4" strokeWidth="0.7" strokeOpacity="0.4" fill="none" />
            <line x1="178" y1="266" x2="178" y2="298" stroke="#F2EEE4" strokeWidth="0.7" strokeOpacity="0.4" />

            {/* Head top indicator */}
            <circle cx="130" cy="28" r="2" fill="#C88B3D" />
            {/* Floor indicator */}
            <circle cx="130" cy="298" r="2" fill="#C88B3D" />
          </svg>
        </div>

        {/* Object Selection */}
        <div className="mb-4 relative">
          <p className="text-xs mb-2" style={{ color: '#8B8478' }}>Reference Object</p>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-left transition-colors"
            style={{ border: '1px solid #2A2521', borderRadius: '4px', background: dropdownOpen ? '#1D1917' : 'transparent' }}
          >
            <span style={{ color: '#F2EEE4' }}>{selectedRef.name}</span>
            <ChevronDown className="w-4 h-4" style={{ color: '#8B8478' }} />
          </button>
          
          {dropdownOpen && (
            <div className="absolute top-full left-0 w-full mt-1 z-10 overflow-hidden" style={{ background: '#1D1917', border: '1px solid #2A2521', borderRadius: '4px' }}>
              {REFERENCE_OBJECTS.map((obj) => (
                <button
                  key={obj.id}
                  onClick={() => {
                    setSelectedRefId(obj.id);
                    setDropdownOpen(false);
                  }}
                  className="w-full text-left px-4 py-3 text-sm transition-colors hover:bg-white/5"
                  style={{ 
                    color: obj.id === selectedRefId ? '#C88B3D' : '#F2EEE4',
                    borderBottom: '1px solid #2A2521' 
                  }}
                >
                  {obj.name} <span className="text-xs opacity-50 ml-1">({obj.sizeCm}cm)</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* CTA */}
        <Link
          href={`/measure?ref=${selectedRef.id}`}
          id="start-measuring-btn"
          className="block w-full text-center py-4 text-sm font-semibold transition-opacity active:opacity-80"
          style={{
            background: '#C88B3D',
            color: '#141110',
            borderRadius: '4px',
          }}
        >
          Start Measuring
        </Link>

        {/* How it works */}
        <div className="mt-8">
          <p className="text-xs mb-4" style={{ color: '#8B8478' }}>How it works</p>
          <div>
            {selectedRef.type === 'ball' ? [
              { step: '1', text: `Place a ${selectedRef.name} on the floor where you will stand.` },
              { step: '2', text: 'Point your camera at the ball. The app locks onto it automatically.' },
              { step: '3', text: 'Stand straight next to the ball with your full body in frame.' },
              { step: '4', text: 'Hold still for a few seconds. Your height is calculated and displayed.' },
            ].map((item, i, arr) => (
              <div key={item.step}>
                <div className="flex items-start gap-4 py-3.5">
                  <span className="font-tabular text-sm shrink-0 w-4 text-right" style={{ color: '#C88B3D', fontWeight: 700 }}>
                    {item.step}
                  </span>
                  <p className="text-sm leading-snug" style={{ color: '#8B8478' }}>{item.text}</p>
                </div>
                {i < arr.length - 1 && <div style={{ height: '1px', background: '#2A2521', marginLeft: '1.75rem' }} />}
              </div>
            )) : [
              { step: '1', text: `Hold the ${selectedRef.name} flat against your chest.` },
              { step: '2', text: 'Stand in front of the camera with your full body in frame.' },
              { step: '3', text: 'Hold still. The app will snap a photo automatically.' },
              { step: '4', text: 'Align the corners on the photo to calculate your height.' },
            ].map((item, i, arr) => (
              <div key={item.step}>
                <div className="flex items-start gap-4 py-3.5">
                  <span className="font-tabular text-sm shrink-0 w-4 text-right" style={{ color: '#C88B3D', fontWeight: 700 }}>
                    {item.step}
                  </span>
                  <p className="text-sm leading-snug" style={{ color: '#8B8478' }}>{item.text}</p>
                </div>
                {i < arr.length - 1 && <div style={{ height: '1px', background: '#2A2521', marginLeft: '1.75rem' }} />}
              </div>
            ))}
          </div>
        </div>

      </main>

      <footer className="px-6 py-5 text-center" style={{ borderTop: '1px solid #2A2521' }}>
        <p className="text-xs" style={{ color: '#8B8478' }}>Best experienced on mobile</p>
      </footer>
    </div>
  );
}
