// One tilcayo fact after every round. All of them come from the sourced profile on /about
// (Current Biology 2026, BBC Discover Wildlife, Scientific American, Wikipedia).

export const FACTS: string[] = [
  "The tilcayo (Leopardus tilcayo) is the first new wild cat species described in more than 100 years.",
  "The last wild cat named before the tilcayo was the Pampas cat, back in 1923.",
  "The tilcayo was formally described in September 2026, in the journal Current Biology.",
  "It's pronounced “til-KYE-oh”.",
  "“Tilcayo” is the name local communities in the Yungas already used for this cat. Scientists kept it to honour that knowledge.",
  "Tilcayos live in the Bolivian Yungas, a cloud forest on the eastern slopes of the Andes.",
  "A tilcayo is smaller than a house cat: about 45 cm (18 in) from head to the base of the tail.",
  "An adult tilcayo weighs roughly 1.3 kg (3 lb).",
  "The tilcayo's tail is about 25–26.5 cm (10 in) long, longer and more slender than an oncilla's.",
  "Look for two dark stripes running down the tilcayo's forehead.",
  "Tilcayos wear a rust-orange coat with large, leopard-like rosettes.",
  "Compared with the oncilla, the tilcayo has bigger rosettes and a more muted coat.",
  "DNA suggests the tilcayo split from its closest tiger-cat relative about 1.4 million years ago.",
  "The tilcayo is a tiger cat: one of South America's small spotted wild cats in the genus Leopardus.",
  "The study that named the tilcayo showed South America's tiger cats are at least five separate species.",
  "Scientists compared the genomes of 38 cats, 26 of them tiger cats, to tell the species apart.",
  "Only one tilcayo is known to science: a ten-year-old male.",
  "The only known tilcayo lives at the Senda Verde Animal Refuge, in the Yungas of Bolivia.",
  "A local family handed the cat to Senda Verde around 2017. Nobody knew he was a new species.",
  "Paola Nogales-Ascarrunz noticed the refuge's spotted cat didn't match any known tiger cat while volunteering there.",
  "The tilcayo was identified by Paola Nogales-Ascarrunz, Jonas Lescroart and Eduardo Eizirik and their team.",
  "Researchers are placing camera traps across the Yungas to find tilcayos in the wild.",
  "In the wild, a tilcayo is easy to mistake for an oncilla or a margay.",
  "The tilcayo hasn't been assessed by the IUCN yet, so nobody knows how endangered it is.",
  "The Yungas are among the least-studied and most species-rich forests of the Neotropics. The tilcayo's discovery could help protect them."
];

const FACT_KEY = "tilcayo.fact";

/** The next fact in a shuffled-once order, so all 25 show before any repeats. */
export function nextFact(): { n: number; text: string } {
  let i = 0;
  try {
    i = Number(localStorage.getItem(FACT_KEY)) || 0;
    localStorage.setItem(FACT_KEY, String((i + 1) % FACTS.length));
  } catch {
    i = Math.floor(Math.random() * FACTS.length);
  }
  // a fixed stride that is coprime with 25 walks every fact once per cycle
  const idx = (i * 7) % FACTS.length;
  return { n: idx + 1, text: FACTS[idx]! };
}
