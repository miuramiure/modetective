import { MAX_GROUPS, type Settings } from "@mdt/core";

interface Option<T> {
  value: T;
  label: string;
  hint: string;
}

function Choices<T extends string | boolean>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
}) {
  return (
    <fieldset>
      <legend>{legend}</legend>
      <div className="choices">
        {options.map((o) => (
          <label className="choice" key={String(o.value)}>
            <input
              type="radio"
              name={name}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            <span>
              {o.label}
              <small>{o.hint}</small>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** ゲームの設定（v1 のホームと同じ項目） */
export function SettingsForm({
  value,
  onChange,
}: {
  value: Settings;
  onChange: (s: Settings) => void;
}) {
  const set = (patch: Partial<Settings>) => onChange({ ...value, ...patch });
  return (
    <>
      <Choices
        legend="お題のモード"
        name="mode"
        value={value.mode}
        onChange={(mode) => set({ mode })}
        options={[
          {
            value: "scenario",
            label: "シナリオモード",
            hint: "ゲーム側が用意した場面や設定でモデリング（T01〜）",
          },
          {
            value: "kikikomi",
            label: "聞き込みモード",
            hint: "チームの1人の実際の経験をもとにモデリング（K01〜）",
          },
        ]}
      />
      <Choices
        legend="カードの提示のしかた"
        name="dist"
        value={value.dist}
        onChange={(dist) => set({ dist })}
        options={[
          {
            value: "individual",
            label: "個別カード方式",
            hint: "グループごとに違うカード。チームは2回まで引き直せる",
          },
          {
            value: "common",
            label: "共通カード方式",
            hint: "全グループのAに同じカード、Bに同じカード。引き直しなし",
          },
        ]}
      />
      <Choices
        legend="目的の答え方"
        name="purpose"
        value={value.purposeChoice}
        onChange={(purposeChoice) => set({ purposeChoice })}
        options={[
          { value: true, label: "選択肢あり", hint: "相手カードの5択から選ぶ" },
          { value: false, label: "選択肢なし", hint: "1文で自由に書く" },
        ]}
      />
      <Choices
        legend="ゲームマスターの参加"
        name="gmplay"
        value={value.gmPlays}
        onChange={(gmPlays) => set({ gmPlays })}
        options={[
          {
            value: false,
            label: "参加しない",
            hint: "GM画面に、配ったカードの場面と目的（答え）を表示する",
          },
          {
            value: true,
            label: "GMも参加する",
            hint: "GM画面では、解決編まで答えを伏せる",
          },
        ]}
      />
      <fieldset>
        <legend>グループ数</legend>
        <input
          type="number"
          min={1}
          max={MAX_GROUPS}
          value={value.groups}
          style={{ width: "6em" }}
          onChange={(e) => {
            const n = Math.max(
              1,
              Math.min(MAX_GROUPS, Number.parseInt(e.target.value, 10) || 1),
            );
            set({ groups: n });
          }}
        />{" "}
        グループ（1グループ＝Aチーム＋Bチーム）
      </fieldset>
    </>
  );
}
