import fs from 'node:fs';

const qa = fs.readFileSync('scripts/visual-qa-iaf.mjs', 'utf8');
// Ghost currently shares cyclops texture — point it at the real ghost skin.
const updatedQa = qa.replace(
  /id: 'ghost',\s*className:[^,]+,\s*tex: '[^']+'/,
  `id: 'ghost',
    className: 'com.github.alexthe666.iceandfire.client.model.ModelGhost',
    tex: 'assets/iceandfire/textures/models/ghost/ghost_white.png'`,
);
fs.writeFileSync('scripts/visual-qa-iaf.mjs', updatedQa);
console.log('ghost QA script updated');
