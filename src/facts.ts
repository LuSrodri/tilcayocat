// One cat fact after every round: house cats of every coat in the shop, cats in general and a
// few about the tilcayo, the wild cat from the Bolivian cloud forest (sourced on /about).

export const FACTS: string[] = [
  "“Tabby” is a pattern, not a breed: stripes, swirls, spots or ticked fur can show up in almost any breed.",
  "Nearly every tabby cat wears a letter “M” on its forehead.",
  "Grey cats are called “blue” by breeders, as in the Russian Blue and the blue British Shorthair.",
  "About four in five orange cats are male: the orange gene rides on the X chromosome.",
  "Orange cats are always tabbies, even when their stripes are faint.",
  "Calico cats are almost always female. Black and orange patches need two X chromosomes.",
  "A male calico usually carries an extra X chromosome (XXY) and is very rare.",
  "In Japan, calico cats are lucky: the waving maneki-neko figurine is traditionally a calico.",
  "A smoke cat looks solid, but its hairs are white at the roots. Part the fur and it shows.",
  "Black cats can “rust”: lots of sunshine turns their coat a reddish brown.",
  "In Britain and Japan, a black cat crossing your path is a sign of good luck.",
  "Many black cats have golden or copper eyes: the dark coat makes the colour pop.",
  "White cats with blue eyes are often born deaf, sometimes only on the blue-eyed side.",
  "Odd eyes, one blue and one gold, are most common in white cats. It's called heterochromia.",
  "House cats descend from the African wildcat and started living with people about 10,000 years ago.",
  "A cat buried with a person in Cyprus about 9,500 years ago is one of the oldest signs of pet cats.",
  "Ships kept cats for centuries to protect food and ropes from mice and rats.",
  "Cats sleep 12 to 16 hours a day. Hunting in short bursts is tiring work.",
  "A cat can turn each ear about 180 degrees, steered by more than 30 muscles.",
  "Cats have a third eyelid, a thin membrane that sweeps across to protect the eye.",
  "Every cat's nose pad has a pattern of bumps and ridges as unique as a fingerprint.",
  "Cats can't taste sweetness: they lack a working sweet taste receptor.",
  "Whiskers help a cat feel its way around in the dark and judge whether a gap is wide enough.",
  "Cats walk by moving both legs on one side, then both on the other, like camels and giraffes.",
  "A group of cats is called a clowder, and a litter of kittens a kindle.",
  "There are about 40 species of wild cats, from tigers to the tiny rusty-spotted cat.",
  "The tilcayo (Leopardus tilcayo), named in 2026, is the first new wild cat species described in over 100 years.",
  "The tilcayo lives in the Bolivian Yungas cloud forest and is smaller than a house cat: about 1.3 kg (3 lb).",
  "Look for two dark stripes running down a tilcayo's forehead, over a rust-orange coat with big rosettes.",
  "Only one tilcayo is known to science: a male living at the Senda Verde Animal Refuge in Bolivia."
];

const FACT_KEY = "tilcayo.fact";

/** The next fact in a shuffled-once order, so all of them show before any repeats. */
export function nextFact(): { n: number; text: string } {
  let i = 0;
  try {
    i = Number(localStorage.getItem(FACT_KEY)) || 0;
    localStorage.setItem(FACT_KEY, String((i + 1) % FACTS.length));
  } catch {
    i = Math.floor(Math.random() * FACTS.length);
  }
  // a fixed stride that is coprime with 30 walks every fact once per cycle
  const idx = (i * 7) % FACTS.length;
  return { n: idx + 1, text: FACTS[idx]! };
}
