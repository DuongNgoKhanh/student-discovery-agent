import { useState } from 'react';
import { archetypes, defaultArchetype } from '../sharecard/content';
import type { ScoreMode } from './MajorCard';
import { ReportView } from './ReportView';

const params = new URLSearchParams(window.location.search);
const archetypeIds = Object.keys(archetypes);

/**
 * Review wrapper around the report: switch archetype, fit display and a phone-sized frame.
 * These controls are for evaluating the mockup, not part of the product.
 */
export function ReportPage() {
  const requested = params.get('archetype');
  const [archetypeId, setArchetypeId] = useState(
    requested && requested in archetypes ? requested : defaultArchetype,
  );
  const [mode, setMode] = useState<ScoreMode>(
    params.get('score') === 'percent' ? 'percent' : 'tier',
  );
  const [phone, setPhone] = useState(params.has('phone'));

  return (
    <div className="pb-10">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 text-sm sm:px-8">
        <Segmented
          label="Nhóm"
          value={archetypeId}
          onChange={setArchetypeId}
          options={archetypeIds.map((id) => ({
            value: id,
            label: archetypes[id]!.content.archetype.title,
          }))}
        />
        <Segmented
          label="Mức phù hợp"
          value={mode}
          onChange={(v) => setMode(v as ScoreMode)}
          options={[
            { value: 'tier', label: 'Mức độ' },
            { value: 'percent', label: '%' },
          ]}
        />
        <Segmented
          label="Khung"
          value={phone ? 'phone' : 'fluid'}
          onChange={(v) => setPhone(v === 'phone')}
          options={[
            { value: 'fluid', label: 'Theo cửa sổ' },
            { value: 'phone', label: 'Điện thoại 390px' },
          ]}
        />
      </div>

      {phone ? (
        <div className="flex justify-center px-4">
          {/* A phone-sized scroll container: the report's container queries pick the mobile layout. */}
          <div className="h-[min(844px,calc(100dvh-140px))] w-[390px] max-w-full overflow-y-auto overscroll-contain rounded-[40px] border-[6px] border-white/15 shadow-2xl">
            <ReportView archetypeId={archetypeId} mode={mode} />
          </div>
        </div>
      ) : (
        <ReportView archetypeId={archetypeId} mode={mode} />
      )}
    </div>
  );
}

function Segmented({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold tracking-[0.12em] text-violet-200/60 uppercase">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex flex-wrap gap-1 rounded-xl bg-white/5 p-1"
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className="min-h-9 cursor-pointer rounded-lg px-3 text-xs font-semibold text-violet-200/70 transition-colors aria-checked:bg-violet-400/25 aria-checked:text-violet-50"
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
