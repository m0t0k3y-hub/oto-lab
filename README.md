# OTO/LAB — はじめてのサウンドデザインとビートメイク

ブラウザでさわって覚える、チュートリアル型の簡易 DAW です。2つのコースがあります。

- **SOUND コース**：シンセサイザーで音そのものをつくり、ゲーム機の起動音のような効果音を WAV で書き出す
- **BEAT コース**：ステップシーケンサーでテクノのビートを組み、ループ素材を WAV で書き出す（DAW がはじめての人向け）

## できること

### SOUND コース

| 章 | テーマ | 主な内容 |
|---|---|---|
| 00 | 音ってなに？ | 周波数・Hz・dB |
| 01 | 波形 | サイン波・矩形波・ノコギリ波・三角波、倍音、スペクトラム |
| 02 | ADSR | エンベロープ（アタック・ディケイ・サステイン・リリース） |
| 03 | フィルター | ローパス・ハイパス、カットオフ、レゾナンス、スウィープ |
| 04 | LFO | ビブラート・トレモロ・ワウ |
| 05 | ノイズ | ホワイトノイズ、ハイハット、ライザー |
| 06 | 空間 | リバーブ・ディレイ |
| 07 | タイムライン | トラック・クリップ・BPM・クオンタイズ |
| 08 | レイヤー | 音域の住み分け、パン、ミュート/ソロ |
| 09 | マスター | ピーク、クリッピング、ノーマライズ、WAV 書き出し |

### BEAT コース

| 章 | テーマ | 主な内容 |
|---|---|---|
| B00 | DAWってなに？ | シーケンサー、ループ、再生ヘッド、ミュート |
| B01 | キック | ステップ、小節、四つ打ち、耳コピ |
| B02 | ハイハット | オープン／クローズ、裏打ち、8分音符 |
| B03 | クラップ | バックビート、16分音符、4点セット |
| B04 | テンポ | BPM、テクノの速さ、タップテンポ |
| B05 | グルーヴ | ベロシティ、スウィング、A/B 比較 |
| B06 | パターン | パターン A/B、フィル、CHAIN、WAV 書き出し |

| B07 | ピアノロール | 音の高さ、オフビートベース、オクターブ、ゲート |
| B08 | アシッドライン | カットオフ、レゾナンス、ENV MOD、アクセント、スライド |
| B09 | スケールとコード | キー、マイナースケール、スケールロック、トライアド、スタブ、コード進行 |
| B10 | オートメーション | ACID CUTOFF / MASTER FILTER、ビルドアップ |
| B11 | アレンジ | パターン A〜D、イントロ、ブレイク、ドロップ、SONG モード |
| B12 | 卒業制作 | 32 小節のテクノトラックを WAV で書き出す |

音はすべて Web Audio API で合成しています（ドラム：`audio/drums.ts`、ベース・アシッド・コード：`audio/synth.ts`）。

- 各ステップは「指示どおりに音を鳴らすと自動でクリア」。お手本の音と聞き比べられます。
- 用語はホバーで意味が出て、覚えた用語は「用語図鑑」にたまります。
- 進捗とプロジェクトはブラウザ（localStorage）に自動保存されます。
- 音はすべて Web Audio API でブラウザ内で生成しています。サーバーは不要です。

## 開発

```bash
npm install
npm run dev        # 開発サーバー（http://localhost:5173）
npm run build      # 型チェック + dist/ にビルド
npm run preview    # ビルド結果を確認
```

## ディレクトリ構成

```
index.html             画面のマークアップ
public/                favicon など
src/
  main.ts              アプリ本体（状態・ガイド・タイムライン・グラフ・書き出し）
  style.css            スタイル
  types.ts             Recipe / Project などの型
  util.ts              clamp, dbToGain
  audio/engine.ts      音のエンジン（シンセ・LFO・ノイズ・リバーブ・ディレイ）
  audio/wav.ts         AudioBuffer → WAV 変換
  audio/drums.ts       BEAT コースのドラム音源（909 風の合成音）
  audio/synth.ts       BEAT コースのベース・アシッド（303 風）・コード音源
  beat/engine.ts       BEAT コースの再生エンジン（ライブ再生・お手本・書き出しで共通）
  beat/seq.ts          BEAT コースの UI（シーケンサー・ピアノロール・オートメーション・アレンジ）
  data/chapters.ts     SOUND コースの章とステップ（クリア条件）
  data/beatChapters.ts BEAT コースの章とステップ、お手本ループ
  data/terms.ts        用語集
  data/defaults.ts     音色の初期値
  data/sample.ts       お手本プロジェクト
  ui/dom.ts            DOM ヘルパー
  ui/knob.ts           ノブ部品
```

`audio/engine.ts` の `makeRig()` は `AudioContext` と `OfflineAudioContext` のどちらでも動くため、
リアルタイム再生と WAV 書き出しで同じ音が鳴ります。

## データ形式（レシピ）

右上の **RECIPE** ボタンで、プロジェクト全体を JSON でコピーできます。
共有 URL やギャラリー機能を足すときは、この形式（`src/types.ts` の `Project`）を使います。

```jsonc
{
  "app": "otolab", "v": 2, "bpm": 100, "master": 0, "normalize": false,
  "tracks": [
    { "name": "BOOM", "vol": 0, "pan": 0, "mute": false, "solo": false,
      "p": { "wave": "sine", "a": 0.003, "d": 1.3, "s": 0, "r": 1.3, "...": "..." },
      "clips": [{ "start": 2, "len": 1, "note": 40 }] }
  ]
}
```

## Cloudflare へのデプロイ

`wrangler.toml` で、ビルド結果の `dist/` を Cloudflare Workers の静的アセットとして配信する設定にしています。

### GitHub と連携して自動デプロイ（おすすめ）

1. Cloudflare ダッシュボード → **Workers & Pages** → **Create** → **Import a repository**（Git リポジトリから作成）
2. GitHub を連携し、`oto-lab` リポジトリを選ぶ
3. ビルド設定
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
4. 保存すると、`main` に push するたびに自動でビルド・公開されます

※ ダッシュボードの項目名は変わることがあります。

### 手元から直接デプロイ

```bash
npx wrangler login
npm run deploy
```

## ライセンス

未定
