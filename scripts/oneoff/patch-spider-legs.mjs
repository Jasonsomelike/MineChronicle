import fs from 'node:fs';
const p = 'src-tauri/src/minecraft/runtime_resources.rs';
let s = fs.readFileSync(p, 'utf8');
const start = s.indexOf('let bones = if spider && width == 64');
const marker = '} else if biped && width == 64';
const end = s.indexOf(marker, start);
if (start < 0 || end < 0) throw new Error('markers');
const neu = `let bones = if spider && width == 64 && height == 32 {
        // Minecraft ModelSpider (Java) — proper leg pivots and Y rotations.
        let mut bones_json = serde_json::json!([
            {"name":"head","pivot":[0,15,-3],"rotation":[0.0,0.0,0.0],"cubes":[{"origin":[-4,-4,-8],"size":[8,8,8],"uv":[32,4]}]},
            {"name":"body","pivot":[0,15,0],"rotation":[0.0,0.0,0.0],"cubes":[{"origin":[-3,-3,-3],"size":[6,6,6],"uv":[0,0]}]},
            {"name":"rear","pivot":[0,15,9],"rotation":[-0.7853982,0.0,0.0],"cubes":[{"origin":[-5,-4,-6],"size":[10,8,12],"uv":[0,12]}]}
        ]);
        if let Some(arr) = bones_json.as_array_mut() {
            let legs: [[f32; 4]; 8] = [
                [-4.0, 15.0, 2.0, 0.7853982],
                [4.0, 15.0, 2.0, -0.7853982],
                [-4.0, 15.0, 1.0, 0.3926991],
                [4.0, 15.0, 1.0, -0.3926991],
                [-4.0, 15.0, 0.0, -0.3926991],
                [4.0, 15.0, 0.0, 0.3926991],
                [-4.0, 15.0, -1.0, -0.7853982],
                [4.0, 15.0, -1.0, 0.7853982],
            ];
            for (i, leg) in legs.iter().enumerate() {
                arr.push(serde_json::json!({
                    "name": format!("leg{i}"),
                    "pivot": [leg[0], leg[1], leg[2]],
                    "rotation": [0.0, leg[3], 0.0],
                    "cubes": [{"origin":[-15,-1,-1],"size":[16,2,2],"uv":[18,0]}]
                }));
            }
        }
        bones_json
    `;
s = s.slice(0, start) + neu + s.slice(end);
fs.writeFileSync(p, s);
console.log('spider legs ok');
