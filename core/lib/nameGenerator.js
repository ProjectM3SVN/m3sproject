// Bộ sinh tên người chơi tự nhiên nhưng luôn giữ tiền tố M3S_ (Tối đa 16 ký tự Minecraft)
const FIRST_NAMES = [
  'Alex', 'Brian', 'Chris', 'David', 'Eric', 'Felix', 'Jack', 'Kevin', 
  'Lucas', 'Max', 'Nick', 'Ryan', 'Sam', 'Tom', 'Victor', 'Leo', 'Dan'
];

const SUFFIXES = [
  'VN', 'Pro', 'Craft', 'Mine', 'Dev', 'Hunter', 'Gamer', 'Build', 'Play'
];

function generateHumanName() {
  const mode = Math.floor(Math.random() * 3);
  let name = '';
  
  if (mode === 0) {
    // Kiểu năm sinh: M3S_Alex_2004
    const fn = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
    const yr = Math.floor(2000 + Math.random() * 12);
    name = `M3S_${fn}_${yr}`;
  } else if (mode === 1) {
    // Kiểu kèm chữ số may mắn: M3S_JackPro99
    const fn = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
    const suf = SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)];
    const num = Math.floor(10 + Math.random() * 89);
    name = `M3S_${fn}${suf}${num}`;
  } else {
    // Kiểu kèm biệt danh game thủ: M3S_KevinGamer
    const fn = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
    const suf = SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)];
    name = `M3S_${fn}${suf}`;
  }

  // Cắt gọt đảm bảo không vượt quá trần 16 ký tự của Mojang/Minecraft
  if (name.length > 16) {
    name = name.slice(0, 16);
  }
  return name;
}

module.exports = { generateHumanName };
