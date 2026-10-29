"""Exclusions — version US : administrations publiques, banques et grandes enseignes / chaînes nationales.

Une fiche est exclue si sa catégorie Google, son nom ou le domaine de son site correspond.
Les chaînes sont reconnues par le domaine de leur site (walmart.com, mcdonalds.com…) et, pour les noms
sans ambiguïté, par le début du nom. Le scan repère aussi tout seul les chaînes absentes de la liste :
un même site web vu sur 5 fiches ou plus (cf. crawler.CHAIN_MIN).
Pour ajouter un mot-clé : champ « Exclusions supplémentaires » du scan automatique.
"""
from __future__ import annotations

import re
from functools import lru_cache
from urllib.parse import urlparse

from categories import load, normalize
from sites import domain

# ---------------------------------------------------------------- Administrations, services publics, banques
PATTERNS = [
    r"\bcity of\b", r"\btown of\b", r"\bvillage of\b", r"\bcounty of\b", r"\bstate of\b", r"\bcommonwealth of\b",
    r"\bcity hall\b", r"\btown hall\b", r"\bvillage hall\b", r"\bcourthouse\b", r"\bcounty (clerk|assessor|treasurer|sheriff)\b",
    r"\bdepartment of\b", r"\bdept\.? of\b", r"\bdmv\b", r"\bmotor vehicles?\b", r"\bpost office\b", r"\busps\b",
    r"\bpolice (department|dept|station)\b", r"\bsheriff'?s? (office|department)\b", r"\bfire (department|station|rescue)\b",
    r"\bpublic (school|schools|library|works|health|defender)\b", r"\bschool district\b", r"\bisd\b",
    r"\bsocial security\b", r"\birs\b", r"\binternal revenue\b", r"\bunemployment\b", r"\bworkforce (center|commission)\b",
    r"\bveterans affairs\b", r"\bva medical\b", r"\bnational guard\b", r"\barmy\b(?! (& |and )?navy surplus)", r"\bnavy\b(?! surplus)",
    r"\bair force\b", r"\bmarine corps\b", r"\bembassy\b", r"\bconsulate\b", r"\bhousing authority\b",
    r"\bpublic housing\b", r"\btransit authority\b", r"\bwater (district|authority)\b", r"\butility district\b",
    r"\bfederal credit union\b", r"\bcredit union\b", r"\bsavings (bank|and loan)\b",
]
# « Bank » dans le nom ne suffit que si la catégorie est vide ou financière (« Food Bank Café », « Bank Street Deli »).
GENERIC_BANK = re.compile(r"\bbank\b|\bbanking\b|\bbancorp\b")
FINANCE_CATEGORY = re.compile(r"financ|bank|atm|credit|savings|loan|corporate office|headquarters")

# Appliqués uniquement à la catégorie Google (mots trop courants dans les noms d'entreprises).
CATEGORY_PATTERNS = [
    r"\bgovernment\b", r"\bmunicipal\b", r"\bpolice\b", r"\bsheriff\b", r"\bcourthouse\b",
    r"\bpost office\b", r"\bbank\b", r"\bbanking\b", r"\bcredit union\b", r"\batm\b", r"financial institution",
    r"savings (bank|institution)", r"\bpublic (school|library|university|health|safety|works)\b", r"\bschool district\b",
    r"\bstate (university|college|park)\b", r"\bcommunity college\b", r"\bmilitary\b", r"\barmed forces\b",
    r"\bfire station\b", r"\bprison\b", r"\bdetention\b", r"\bembassy\b", r"\bconsulate\b",
    r"\butility company\b", r"\bwater utility\b", r"\belectric utility\b", r"\bgas company\b",
]
# Catégories de la famille « Government & Public Services » qui sont en fait des commerces : on les garde.
KEEP_CATEGORIES = {normalize(c) for c in (
    "Army & navy surplus shop", "Bocce ball court", "Futsal court", "Handball court", "Padel court", "Pickleball court",
    "Passport photo processor", "Fire department equipment supplier", "Police supply store",
    "Non-governmental organization",
)}

DOMAINS = [
    r"\.(gov|mil|edu)$", r"\.k12\.[a-z]{2}\.us$", r"(^|\.)(ci|co|city|town|vil|twp|state)\.[a-z0-9.-]+\.[a-z]{2}\.us$",
    r"^(www\.)?(cityof|townof|villageof|countyof|city-of|town-of|county-of)[a-z-]", r"(^|\.)usps\.com$",
]

# ---------------------------------------------------------------- Grandes enseignes et chaînes nationales
CHAIN_DOMAINS = set("""
walmart.com samsclub.com target.com costco.com kroger.com albertsons.com safeway.com publix.com heb.com wegmans.com
meijer.com aldi.us lidl.com wholefoodsmarket.com traderjoes.com sprouts.com foodlion.com stopandshop.com giantfood.com
giantfoodstores.com shoprite.com winndixie.com hy-vee.com harristeeter.com ralphs.com fredmeyer.com kingsoopers.com
smithsfoodanddrug.com frysfood.com vons.com jewelosco.com acmemarkets.com shaws.com hannaford.com savealot.com
foodmaxx.com winco.com stater-bros.com staterbros.com raleys.com biglots.com dollargeneral.com dollartree.com
familydollar.com fivebelow.com homedepot.com lowes.com menards.com acehardware.com truevalue.com harborfreight.com
tractorsupply.com northerntool.com bestbuy.com apple.com microsoft.com gamestop.com staples.com officedepot.com
macys.com kohls.com jcpenney.com nordstrom.com nordstromrack.com dillards.com belk.com tjmaxx.com tjx.com marshalls.com
homegoods.com rossstores.com burlington.com oldnavy.com gap.com bananarepublic.com hm.com zara.com uniqlo.com
forever21.com ae.com abercrombie.com hollisterco.com victoriassecret.com bathandbodyworks.com ulta.com sephora.com
sallybeauty.com footlocker.com famousfootwear.com dsw.com payless.com rackroomshoes.com skechers.com nike.com
adidas.com underarmour.com dickssportinggoods.com academy.com bassproshops.com cabelas.com rei.com bedbathandbeyond.com
wayfair.com ikea.com ashleyfurniture.com ashleyhomestore.com rooms-to-go.com roomstogo.com mattressfirm.com
sleepnumber.com lazboy.com havertys.com pier1.com crateandbarrel.com potterybarn.com williams-sonoma.com
michaels.com joann.com hobbylobby.com partycity.com petsmart.com petco.com autozone.com oreillyauto.com
advanceautoparts.com napaonline.com pepboys.com discounttire.com firestonecompleteautocare.com goodyear.com
goodyearautoservice.com midas.com meineke.com jiffylube.com valvoline.com vioc.com take5oilchange.com maaco.com
safelite.com caliber.com calibercollision.com gerbercollision.com carmax.com carvana.com enterprise.com hertz.com
avis.com budget.com nationalcar.com alamo.com thrifty.com dollar.com uhaul.com penskeautomotive.com cvs.com
walgreens.com riteaid.com gnc.com vitaminshoppe.com att.com verizon.com t-mobile.com metrobyt-mobile.com
cricketwireless.com boostmobile.com sprint.com xfinity.com spectrum.com cox.com ups.com theupsstore.com fedex.com
dhl.com usps.com mcdonalds.com burgerking.com bk.com wendys.com tacobell.com kfc.com subway.com chick-fil-a.com
starbucks.com dunkindonuts.com dunkin.com pizzahut.com dominos.com papajohns.com littlecaesars.com papamurphys.com
marcos.com sonicdrivein.com arbys.com jackinthebox.com carlsjr.com hardees.com whataburger.com in-n-out.com
fiveguys.com shakeshack.com culvers.com dairyqueen.com popeyes.com chipotle.com qdoba.com moes.com panerabread.com
jimmyjohns.com jerseymikes.com firehousesubs.com potbelly.com wingstop.com buffalowildwings.com zaxbys.com
raisingcanes.com bojangles.com churchs.com elpolloloco.com pandaexpress.com wafflehouse.com ihop.com dennys.com
crackerbarrel.com applebees.com chilis.com olivegarden.com redlobster.com outback.com longhornsteakhouse.com
texasroadhouse.com tgifridays.com fridays.com rubytuesday.com redrobin.com bobevans.com perkins.com goldencorral.com
cheesecakefactory.com pfchangs.com bjsrestaurants.com hooters.com dennys.com krispykreme.com timhortons.com
baskinrobbins.com coldstonecreamery.com auntieannes.com cinnabon.com jambajuice.com jamba.com smoothieking.com
tropicalsmoothiecafe.com dutchbros.com peets.com caribou-coffee.com cariboucoffee.com einsteinbros.com
marriott.com hilton.com hyatt.com ihg.com choicehotels.com wyndhamhotels.com bestwestern.com radissonhotels.com
motel6.com redroof.com laquinta.com extendedstayamerica.com sonesta.com accor.com 24hourfitness.com
planetfitness.com lafitness.com anytimefitness.com goldsgym.com crunch.com orangetheory.com snapfitness.com
ymca.org ymca.net equinox.com lifetime.life greatclips.com supercuts.com sportclips.com fantasticsams.com
costcutters.com regissalons.com smartstyle.com hairclub.com europeanwax.com europeanwaxcenter.com massageenvy.com
handandstone.com heartlanddental.com aspendental.com westerndental.com smilebrands.com brightnow.com
vca.com vcahospitals.com banfield.com bluepearlvet.com lenscrafters.com pearlevision.com visionworks.com
americasbest.com eyeglassworld.com hrblock.com jacksonhewitt.com libertytax.com statefarm.com allstate.com
farmersagent.com farmers.com geico.com progressive.com nationwide.com libertymutual.com amfam.com
edwardjones.com ameriprise.com raymondjames.com morganstanley.com merrilledge.com schwab.com fidelity.com
remax.com kw.com kellerwilliams.com century21.com coldwellbanker.com coldwellbankerhomes.com sothebysrealty.com
bhgre.com era.com exprealty.com compass.com redfin.com zillow.com realtor.com weichert.com howardhanna.com
berkshirehathawayhs.com publicstorage.com extraspace.com cubesmart.com lifestorage.com uhaul.com
twomenandatruck.com servpro.com servicemaster.com stanleysteemer.com chemdry.com mollymaid.com merrymaids.com
terminix.com orkin.com rollins.com truly-nolen.com trulynolen.com roto-rooter.com rotorooter.com mrrooter.com
mrelectric.com onehourheatandair.com aireserv.com benfranklinplumbing.com mrhandyman.com handyman.com
twomenandatruck.com 1800gotjunk.com collegehunks.com junkking.com sherwin-williams.com benjaminmoore.com
certapro.com fivestarpainting.com chase.com bankofamerica.com wellsfargo.com citi.com citibank.com usbank.com
pnc.com truist.com tdbank.com capitalone.com regions.com keybank.com fifththird.com huntington.com bmo.com
mtb.com citizensbank.com ally.com navyfederal.org penfed.org westernunion.com moneygram.com
amctheatres.com regmovies.com cinemark.com chuckecheese.com daveandbusters.com topgolf.com
kindercare.com learningcareGroup.com brighthorizons.com goddardschool.com primroseschools.com
lacare.com kaiserpermanente.org kp.org hcahealthcare.com questdiagnostics.com labcorp.com
cvshealth.com minuteclinic.com concentra.com
""".lower().split())

# Noms sans ambiguïté (comparés au début du nom, sans accents) : « Walmart Supercenter », « McDonald's »…
CHAIN_NAMES = [
    "walmart", "sam's club", "costco", "kroger", "safeway", "publix", "h-e-b", "aldi", "whole foods", "trader joe's",
    "dollar general", "dollar tree", "family dollar", "five below", "home depot", "the home depot", "lowe's", "menards",
    "ace hardware", "harbor freight", "tractor supply", "best buy", "gamestop", "staples", "office depot", "officemax",
    "macy's", "kohl's", "jcpenney", "nordstrom", "dillard's", "tj maxx", "t.j. maxx", "marshalls", "homegoods",
    "ross dress for less", "burlington", "old navy", "foot locker", "dick's sporting goods", "bass pro shops",
    "cabela's", "petsmart", "petco", "autozone", "o'reilly auto parts", "advance auto parts", "napa auto parts",
    "pep boys", "discount tire", "firestone complete auto care", "jiffy lube", "valvoline instant oil change",
    "take 5 oil change", "safelite", "carmax", "enterprise rent-a-car", "hertz", "avis", "u-haul", "cvs pharmacy",
    "walgreens", "rite aid", "gnc", "the ups store", "fedex office", "mcdonald's", "burger king", "wendy's",
    "taco bell", "kfc", "chick-fil-a", "starbucks", "dunkin", "pizza hut", "domino's", "papa john's",
    "little caesars", "sonic drive-in", "arby's", "jack in the box", "carl's jr", "hardee's", "whataburger",
    "in-n-out", "five guys", "dairy queen", "popeyes", "chipotle", "panera bread", "jimmy john's", "jersey mike's",
    "firehouse subs", "wingstop", "buffalo wild wings", "zaxby's", "raising cane's", "bojangles", "church's",
    "el pollo loco", "panda express", "waffle house", "ihop", "denny's", "cracker barrel", "applebee's", "chili's",
    "olive garden", "red lobster", "outback steakhouse", "longhorn steakhouse", "texas roadhouse", "tgi fridays",
    "red robin", "bob evans", "golden corral", "the cheesecake factory", "p.f. chang's", "krispy kreme",
    "baskin-robbins", "cold stone creamery", "auntie anne's", "cinnabon", "jamba", "smoothie king",
    "tropical smoothie cafe", "dutch bros", "planet fitness", "la fitness", "anytime fitness", "gold's gym",
    "orangetheory", "great clips", "supercuts", "sport clips", "fantastic sams", "european wax center",
    "massage envy", "aspen dental", "banfield pet hospital", "vca ", "lenscrafters", "pearle vision", "h&r block",
    "jackson hewitt", "liberty tax", "state farm", "allstate", "farmers insurance", "edward jones", "re/max",
    "keller williams", "century 21", "coldwell banker", "public storage", "extra space storage", "cubesmart",
    "servpro", "stanley steemer", "chem-dry", "molly maid", "merry maids", "terminix", "orkin", "roto-rooter",
    "two men and a truck", "1-800-got-junk", "sherwin-williams", "chase bank", "bank of america", "wells fargo",
    "citibank", "u.s. bank", "pnc bank", "td bank", "capital one", "western union", "amc ", "regal ", "cinemark",
    "chuck e. cheese", "dave & buster's", "kindercare", "quest diagnostics", "labcorp", "minuteclinic",
]


@lru_cache(maxsize=None)
def _regex(extra: tuple[str, ...] = ()) -> re.Pattern:
    words = PATTERNS + [r"\b" + re.escape(normalize(w.strip())) + r"\b" for w in extra if w.strip()]
    return re.compile("|".join(f"(?:{p})" for p in words))


@lru_cache(maxsize=1)
def _public_categories() -> frozenset[str]:
    """Toutes les catégories Google de la famille « Government & Public Services »."""
    return frozenset(normalize(r["en"]) for r in load() if r.get("bucket") == "Government & Public Services") - KEEP_CATEGORIES


_DOMAIN_RE = re.compile("|".join(DOMAINS))
_CATEGORY_RE = re.compile("|".join(f"(?:{p})" for p in CATEGORY_PATTERNS))
_CHAIN_RE = re.compile(r"^(the )?(" + "|".join(re.escape(normalize(n)) for n in CHAIN_NAMES) + r")")


def excluded_category(label: str, extra: tuple[str, ...] = ()) -> bool:
    n = normalize(label or "")
    return n in _public_categories() or bool(_regex(extra).search(n) or _CATEGORY_RE.search(n))


def chain_reason(nom: str, site: str = "") -> str | None:
    if site and domain(site) in CHAIN_DOMAINS:
        return f"chaîne ({domain(site)})"
    m = _CHAIN_RE.search(normalize(nom or ""))
    return f"chaîne « {m.group(2).strip()} »" if m else None


def exclusion_reason(nom: str, categorie: str = "", site: str = "", extra: tuple[str, ...] = ()) -> str | None:
    """Renvoie la raison de l'exclusion, ou None si la fiche est conservée."""
    if categorie and excluded_category(categorie, extra):
        return f"catégorie « {categorie} »"
    n = normalize(nom or "")
    m = _regex(extra).search(n)
    if m:
        return f"nom « {m.group(0)} »"
    m = GENERIC_BANK.search(n)
    if m and (not categorie or FINANCE_CATEGORY.search(normalize(categorie))):
        return f"nom « {m.group(0)} »"
    host = (urlparse(site).hostname or "").lower() if site else ""
    if host and _DOMAIN_RE.search(host):
        return f"site {host}"
    return chain_reason(nom, site)
