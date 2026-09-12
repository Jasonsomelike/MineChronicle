"""Read installed JAR resource references; never load or execute game classes."""
import json
import pathlib
import re
import struct
import zipfile
from functools import lru_cache

def read(path):
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8-sig"))

def constants(data):
    if data[:4] != b"\xca\xfe\xba\xbe":
        return []
    count = struct.unpack_from(">H", data, 8)[0]
    cursor, index, result = 10, 1, []
    while index < count:
        tag = data[cursor]
        cursor += 1
        if tag == 1:
            size = struct.unpack_from(">H", data, cursor)[0]
            cursor += 2
            result.append(data[cursor:cursor+size].decode("utf-8", errors="replace"))
            cursor += size
        elif tag in (3,4,9,10,11,12,17,18):
            cursor += 4
        elif tag in (5,6):
            cursor += 8
            index += 1
        elif tag in (7,8,16,19,20):
            cursor += 2
        elif tag == 15:
            cursor += 3
        else:
            raise ValueError(f"Unsupported class constant {tag}")
        index += 1
    return result

def normalize(name):
    name = pathlib.PurePosixPath(name).name.replace(".class","")
    name = re.sub(r"^(?:Model|Render|Entity)", "", name)
    name = re.sub(r"(?:Model|Renderer|Render|Entity)$", "", name)
    return re.sub("[^a-z0-9]", "", name.lower())

@lru_cache(maxsize=128)
def archive_info(path):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        classes = {n: constants(archive.read(n)) for n in names
                   if n.endswith(".class") and
                   re.search(r"(?:Model|Render)[^/]*\.class$",n)}
    return set(names), classes

def discover():
    index = read(".local/assets-index-0107.json")
    coverage = read(".local/coverage-before-0107.json")
    output = {}
    for row in coverage["resources"]:
        if not row["entity"]:
            continue
        namespace,name=row["key"].split(":",1)
        key = normalize({
            "ars_nouveau:wilden_boss": "WildenChimera",
        }.get(row["key"],name))
        for root in row["roots"]:
            candidates=[]
            for source in index.get(str(root),{}).get(namespace,[]):
                names,classes=archive_info(source["jar"])
                matches=[(path,values) for path,values in classes.items() if normalize(path)==key]
                if not matches:
                    continue
                strings=set()
                for path,values in matches:
                    strings.update(values)
                    # Shared geometry resides in a parent/model referenced by the renderer.
                    for value in values:
                        if value+".class" in classes:
                            strings.update(classes[value+".class"])
                assets=[]
                for value in sorted(strings):
                    if not value.endswith((".png",".json",".tbl")) or "(" in value:
                        continue
                    asset = value if value.startswith("assets/") else f"assets/{namespace}/{value}"
                    if ":" in value:
                        ns,relative=value.split(":",1)
                        asset=f"assets/{ns}/{relative}"
                    if namespace == "twilightforest" and "/" not in value and "getModelTexture" in strings:
                        # TwilightForestMod.getModelTexture prefixes this directory.
                        asset=f"assets/twilightforest/textures/model/{value}"
                    if asset in names:
                        assets.append(asset)
                candidates.append({
                    "jar":source["jar"],
                    "classes":[path for path,_ in matches],
                    "references":assets,
                    "model_classes":[value+".class" for value in sorted(strings)
                        if value+".class" in classes and re.search(r"(?:Model[^/]*|[^/]*Model)\.class$",value+".class")],
                    "vanilla_models":[value for value in sorted(strings)
                        if re.match(r"net/minecraft/client/model/[^/]+Model$",value)],
                    "matching_geometry":[n for n in names if n.startswith(f"assets/{namespace}/")
                        and n.endswith(".geo.json") and normalize(n.replace(".geo.json",""))==key],
                })
            if candidates:
                output[f"{root}|{row['key']}"]=candidates
    pathlib.Path(".local/stat-discovered-bindings.json").write_text(
        json.dumps(output,ensure_ascii=False,indent=2),encoding="utf-8")
    print(f"Discovered source bindings for {len(output)} entity/root pairs.")

if __name__ == "__main__":
    discover()
