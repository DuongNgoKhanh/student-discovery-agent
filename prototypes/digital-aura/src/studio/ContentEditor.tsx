import type { ShareCardData } from '../sharecard/types';

interface ContentEditorProps {
  data: ShareCardData;
  onChange(data: ShareCardData): void;
  disabled?: boolean;
}

export function ContentEditor({ data, onChange, disabled }: ContentEditorProps) {
  const archetype = (patch: Partial<ShareCardData['archetype']>) =>
    onChange({ ...data, archetype: { ...data.archetype, ...patch } });

  return (
    <fieldset disabled={disabled} className="space-y-4">
      <legend className="sr-only">Nội dung thẻ</legend>
      <Field
        id="name"
        label="Họ tên"
        value={data.name}
        maxLength={32}
        autoComplete="name"
        onChange={(name) => onChange({ ...data, name })}
      />
      <div className="grid grid-cols-[1fr_96px] gap-3">
        <Field
          id="title"
          label="Nhóm tính cách"
          value={data.archetype.title}
          maxLength={28}
          onChange={(title) => archetype({ title })}
        />
        <Field
          id="edition"
          label="Số thứ tự"
          value={data.archetype.edition ?? ''}
          maxLength={8}
          onChange={(edition) => archetype({ edition: edition || undefined })}
        />
      </div>
      <Field
        id="subtitle"
        label="Tên tiếng Anh"
        value={data.archetype.subtitle}
        maxLength={28}
        onChange={(subtitle) => archetype({ subtitle })}
      />
      <div>
        <span className="field-label" id="strengths-label">
          Điểm mạnh
        </span>
        <div className="grid grid-cols-3 gap-2" role="group" aria-labelledby="strengths-label">
          {data.strengths.map((strength, i) => (
            <input
              key={i}
              aria-label={`Điểm mạnh ${i + 1}`}
              value={strength.label}
              maxLength={14}
              onChange={(e) =>
                onChange({
                  ...data,
                  strengths: data.strengths.map((s, j) =>
                    j === i ? { ...s, label: e.target.value } : s,
                  ),
                })
              }
              className="text-input text-center"
            />
          ))}
        </div>
      </div>
      {data.fields && (
        <div>
          <span className="field-label" id="fields-label">
            Lĩnh vực
          </span>
          <div className="grid grid-cols-3 gap-2" role="group" aria-labelledby="fields-label">
            {data.fields.map((field, i) => (
              <input
                key={i}
                aria-label={`Lĩnh vực ${i + 1}`}
                value={field}
                maxLength={14}
                onChange={(e) =>
                  onChange({
                    ...data,
                    fields: data.fields!.map((f, j) => (j === i ? e.target.value : f)),
                  })
                }
                className="text-input text-center"
              />
            ))}
          </div>
        </div>
      )}
      {!data.fields && (
        <Field
          id="tagline"
          label="Lời nhắn"
          value={data.tagline}
          maxLength={40}
          onChange={(tagline) => onChange({ ...data, tagline })}
        />
      )}
    </fieldset>
  );
}

function Field({
  id,
  label,
  value,
  maxLength,
  autoComplete = 'off',
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  maxLength: number;
  autoComplete?: string;
  onChange(value: string): void;
}) {
  return (
    <div>
      <label htmlFor={`field-${id}`} className="field-label">
        {label}
      </label>
      <input
        id={`field-${id}`}
        value={value}
        maxLength={maxLength}
        autoComplete={autoComplete}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        className="text-input"
      />
    </div>
  );
}
