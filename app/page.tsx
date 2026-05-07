import Link from 'next/link';
import { Ruler, MoveHorizontal, ArrowUpFromLine, ChevronRight, Smartphone } from 'lucide-react';

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-zinc-950 text-white">
      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        {/* Logo / Brand */}
        <div className="mb-8 flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center mb-4 shadow-lg shadow-blue-500/20">
            <Ruler className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-center">
            AI Body Measure
          </h1>
          <p className="text-zinc-400 text-center mt-2 max-w-xs text-sm leading-relaxed">
            Measure your height, wingspan, and standing reach using just your phone camera
          </p>
        </div>

        {/* Feature cards */}
        <div className="w-full max-w-sm space-y-3 mb-10">
          {[
            {
              icon: <Ruler className="w-5 h-5" />,
              title: 'Height',
              desc: 'Head to toe measurement',
              gradient: 'from-blue-500 to-cyan-400',
            },
            {
              icon: <MoveHorizontal className="w-5 h-5" />,
              title: 'Wingspan',
              desc: 'Fingertip to fingertip span',
              gradient: 'from-violet-500 to-purple-400',
            },
            {
              icon: <ArrowUpFromLine className="w-5 h-5" />,
              title: 'Standing Reach',
              desc: 'Floor to raised fingertip',
              gradient: 'from-amber-500 to-orange-400',
            },
          ].map((feature) => (
            <div
              key={feature.title}
              className="flex items-center gap-4 p-4 rounded-2xl bg-zinc-900/80 border border-zinc-800/60"
            >
              <div
                className={`p-2.5 rounded-xl bg-gradient-to-br ${feature.gradient} text-white shrink-0`}
              >
                {feature.icon}
              </div>
              <div>
                <p className="text-white text-sm font-semibold">{feature.title}</p>
                <p className="text-zinc-500 text-xs">{feature.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <Link
          href="/measure"
          className="w-full max-w-sm flex items-center justify-center gap-2 py-4 rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 text-white text-base font-semibold transition-all hover:from-blue-500 hover:to-blue-400 active:scale-[0.98] shadow-lg shadow-blue-600/25"
        >
          Start Measuring
          <ChevronRight className="w-5 h-5" />
        </Link>

        {/* How it works */}
        <div className="w-full max-w-sm mt-10">
          <h2 className="text-zinc-500 text-xs font-semibold uppercase tracking-widest text-center mb-4">
            How it works
          </h2>
          <div className="space-y-3">
            {[
              { step: '1', text: 'Place a Size 7 basketball on the floor' },
              { step: '2', text: 'Align it with the on-screen guide to calibrate' },
              { step: '3', text: 'Stand in front of the camera for each pose' },
              { step: '4', text: 'Get your measurements instantly' },
            ].map((item) => (
              <div
                key={item.step}
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-zinc-900/50 border border-zinc-800/40"
              >
                <div className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-zinc-300">{item.step}</span>
                </div>
                <p className="text-zinc-300 text-sm">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="px-6 py-6 text-center border-t border-zinc-900">
        <div className="flex items-center justify-center gap-1.5 text-zinc-600 text-xs">
          <Smartphone className="w-3.5 h-3.5" />
          <span>Best experienced on mobile</span>
        </div>
      </footer>
    </div>
  );
}
