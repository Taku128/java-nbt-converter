# `.nbt` (Java Structure) フォーマット仕様

Minecraft Java Edition のストラクチャーブロックが読み書きする標準フォーマット。
本ライブラリの **入力** (パススルー扱い) と **出力** (litematic/schem からの変換結果) の両方で使う。

## ファイル形式

- 圧縮: **gzip**
- NBT: **Big-Endian**
- 拡張子: `.nbt`
- ルートタグ名: 空文字列 `""` (Java Structure の慣例)

## ルート構造

```text
Compound {
  DataVersion: Int            // Minecraft Java DataVersion (例: 3953 = 1.20.4)
  size:        List<Int>[3]   // [sizeX, sizeY, sizeZ]
  palette:     List<Compound> [
    {
      Name: String,             // 例: "minecraft:redstone_lamp"
      Properties?: Compound<String,String>
    }, ...
  ]
  blocks: List<Compound> [
    {
      pos:   List<Int>[3],      // [x, y, z] ∈ [0, size)
      state: Int,               // palette のインデックス
      nbt?:  Compound           // BlockEntity NBT (任意)
    }, ...
  ]
  entities: List<Compound> [
    {
      pos:      List<Double>[3], // 世界空間での絶対位置 (size 範囲内の浮動小数)
      blockPos: List<Int>[3],    // 占有ブロック (floor(pos))
      nbt:      Compound         // Entity NBT
    }, ...
  ]
}
```

## 座標系

- 原点 `(0, 0, 0)` は構造体の **最小コーナー**。
- すべてのブロックは `[0, size)` の範囲に収まる。
- size は **常に正**。Litematica と異なり負成分は許されない。

## パレット

- `Name` は名前空間付き ID (`minecraft:xxx` 形式)。
- `Properties` の値はすべて `String`。bool や int も `"true"` / `"5"` のように文字列化する。
- パレット先頭は air である必要はない (空気ブロックを格納するかどうかは出力側の判断)。
- 本ライブラリは air を blocks から除外して出力するため、palette に air を入れていない (deepslate の Structure はこれを許容する)。

## blocks

- `pos` は Int リスト (NbtList<NbtInt>)。
- `state` は palette index (0-based)。
- `nbt` は省略可。チェスト等の BlockEntity を持つブロックでのみ付与する。
- 並び順は仕様上自由 (本ライブラリは `y → z → x` の昇順で出力)。

## entities

- `pos` は Double リスト。エンティティはサブブロック精度で配置可能。
- `blockPos` は `floor(pos)` で、占有ブロック判定に使う。
- Litematica の `Entities` を変換する場合、各エンティティの `Pos` (Bedrock の `Pos` フィールド) を effective origin 加算して絶対座標化する。

## エンコード詳細 (本ライブラリの実装)

`src/encoder.ts` で deepslate の NBT クラスを使って書き出す:

```ts
const root = new NbtCompound();
root.set('DataVersion', new NbtInt(dataVersion));
root.set('size', int32List([sx, sy, sz]));
root.set('palette', paletteList);
root.set('blocks', blocksList);
root.set('entities', entitiesList);

const file = new NbtFile('', root, 'gzip', false /* littleEndian */, undefined);
return file.write();  // Uint8Array (gzipped)
```

## デコード

deepslate の `NbtFile.read(bytes)` がヘッダーから圧縮種別 (none/gzip/zlib) と littleEndian を自動判定するので、本ライブラリの読み取りは

```ts
const nbt = NbtFile.read(bytes);
const structure = Structure.fromNbt(nbt.root);  // deepslate
```

の二行で済む。

## .nbt の "Bedrock" 別形態に関する注意

拡張子 `.nbt` で配布されるが Bedrock の LE NBT になっているケースがある (Bedrock の Structure Block 出力)。
`sniffFormat()` で Java NBT として識別できない場合は `@taku128/mcstructure` (`convertMcstructureBuffer`) にフォールバックさせる:

```ts
if (sniff.format === 'unknown' && ext === 'nbt') {
  return convertBedrockMcstructure(bytes);  // Bedrock LE NBT として再解釈
}
```

## 参照

- 公式 wiki: https://minecraft.wiki/w/Structure_file
- deepslate Structure: https://github.com/misode/deepslate
- 本ライブラリ実装: `packages/js/java-schematic/src/encoder.ts` / `src/sniffer.ts`
