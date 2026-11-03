import {
  HomeCards,
  HomeConcept,
  HomeContact,
  HomeDemo,
  HomeFinalCta,
  HomeHero,
  HomeSectors,
  HomeTargetAndFind,
} from './_components/home/home-sections';

/**
 * Page d'accueil Prospectigo « façon Apollo en bleu » (3/11/2026) : hero
 * animé, secteurs, concept Ciblez · Trouvez · Contactez, focus Cibler et
 * Trouver, démo en milieu de page, focus Contacter, quatre cartes, bandeau
 * final. L'ancienne page d'accueil est gardée dans /archives/accueil-v1.
 */
function Home() {
  return (
    <div className={'hp'}>
      <HomeHero />
      <HomeSectors />
      <HomeConcept />
      <HomeTargetAndFind />
      <HomeDemo />
      <HomeContact />
      <HomeCards />
      <HomeFinalCta />
    </div>
  );
}

export default Home;
