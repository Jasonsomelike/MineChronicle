"""Read original Tabula model/skin pairs; never load or execute Minecraft code."""
import hashlib
import io
import json
import math
import pathlib
import zipfile

read = lambda path: json.loads(pathlib.Path(path).read_text(encoding="utf-8-sig"))
output = pathlib.Path(".local/textures-0107-tabula")
output.mkdir(parents=True, exist_ok=True)
index = read(".local/assets-index-0107.json")
requests = read(".local/stat-icon-requests.json")
manifest = {}
for request in requests:
    if not request.get("entity"):
        continue
    key = request["key"]
    if key not in ("iceandfire:fire_dragon", "iceandfire:ice_dragon", "iceandfire:lightning_dragon"):
        continue
    species = key.split(":")[1].replace("_", "")
    identity = f'{request["root"]}|entity:{key}'
    if identity in manifest:
        continue
    for pack in index.get(str(request["root"]), {}).get("iceandfire", []):
        model_path = f"assets/iceandfire/models/tabula/{species}/{species}_ground.tbl"
        if model_path not in pack["assets"]:
            continue
        with zipfile.ZipFile(pack["jar"]) as jar:
            with zipfile.ZipFile(io.BytesIO(jar.read(model_path))) as tbl:
                model = json.loads(tbl.read("model.json"))
                # The model's own author-supplied skin is a representative.
                # Statistics do not retain dragon color, sex or growth stage.
                texture = tbl.read("texture.png")
        if model.get("cubeGroups") or model.get("scale", [1, 1, 1]) != [1, 1, 1]:
            raise ValueError(f"Unsupported Tabula group/scale: {model_path}")
        bones = []
        def visit(cubes, parent=None):
            for index, cube in enumerate(cubes):
                name = (parent + "/" if parent else "") + f'{cube["name"]}[{index}]'
                bones.append({
                    "name": name, **({"parent": parent} if parent else {}),
                    "pivot": cube["position"],
                    "rotation": [math.radians(x) for x in cube["rotation"]],
                    "scale": cube["scale"],
                    "hidden": cube.get("hidden", False),
                    "cubes": [{"origin": cube["offset"], "size": cube["dimensions"],
                               "uv": cube["txOffset"], "mirror": cube["txMirror"],
                               "inflate": cube["mcScale"]}],
                })
                visit(cube.get("children", []), name)
        visit(model["cubes"])
        filename = hashlib.sha256(texture).hexdigest() + ".png"
        (output / filename).write_bytes(texture)
        manifest[identity] = {
            "kind": "model",
            "entityModel": {"format": "java", "textureWidth": model["textureWidth"],
                            "textureHeight": model["textureHeight"], "bones": bones},
            "layers": [{"file": filename, "source": f'{pathlib.Path(pack["jar"]).name} > {model_path} > model.json + texture.png (author-supplied representative)'}],
        }
        break
(output / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
print(f"Exported {len(manifest)} original Tabula model/skin pairs")
