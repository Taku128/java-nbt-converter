/**
 * 変換出力 (gzip Java Structure NBT) を deepslate で読み、比較しやすい形に落とす。
 * redtact のビューアと同じ経路 (NbtFile.read → Structure.fromNbt) を使うことで
 * 「ビューアが実際に見る姿」を検証する。
 */
import { NbtFile } from "deepslate";
import { Structure } from "deepslate/core";

export function canonicalState(name, properties) {
  const keys = Object.keys(properties ?? {}).sort();
  return keys.length ? `${name}[${keys.map((k) => `${k}=${properties[k]}`).join(",")}]` : name;
}

/** gzip structure NBT → { size, dataVersion, blocks: Map<"x,y,z", state文字列>, nbtByPos } */
export function readStructure(bytes) {
  const file = NbtFile.read(bytes);
  const structure = Structure.fromNbt(file.root);
  const blocks = new Map();
  const nbtByPos = new Map();
  for (const b of structure.getBlocks()) {
    const key = b.pos.join(",");
    const props = b.state.getProperties();
    blocks.set(key, canonicalState(b.state.getName().toString(), props));
    if (b.nbt) nbtByPos.set(key, b.nbt.toSimplifiedJson());
  }
  return {
    size: structure.getSize() ? [...structure.getSize()] : [0, 0, 0],
    dataVersion: file.root.getNumber("DataVersion"),
    blocks,
    nbtByPos,
    entities: file.root.getList("entities").toSimplifiedJson(),
  };
}
