// Gedeelde datavormen. Alles staat als JSON in de privé-repository met gegevens.

/** Soort winkel: een product "voor elke supermarkt" verschijnt bij alle supermarkten. */
export type Kind = 'super' | 'drogist' | 'online' | 'bouw' | 'dier' | 'slager' | 'overig';

export interface ListItem {
  id: string;
  name: string;
  /** Eigenschap zoals "bio" of "500 ml" */
  spec: string | null;
  qty: number;
  /** Alleen bij deze keten, of… */
  chain: string | null;
  /** …bij elke winkel van deze soorten */
  kinds: Kind[] | null;
  /** true = van de lijst, staat bij "Onlangs" */
  done: boolean;
  doneAt: number | null;
  createdAt: number;
  addedBy: string | null;
  productId: string | null;
  dealId: string | null;
}

export interface ListFile { items: ListItem[] }

export interface Address { id: string; name: string; place: string; lat: number; lon: number; radius: number }

export interface Store { id: string; chain: string; name: string; place: string; type: string; lat?: number; lon?: number; online?: boolean; follow: boolean }

export interface Product {
  id: string;
  name: string;
  /** Oud veld, niet meer gebruikt */
  cat?: string;
  /** Waar het te koop is; leeg = maakt niet uit */
  where: Kind[];
  loose: boolean;
  /** Voorkeursmerk, bijv. "Campina"; leeg = maakt niet uit */
  brand?: string | null;
  /** Wat je precies wilt, bijv. "groot stuk, jong belegen" of "halfvol" */
  wants?: string | null;
  /** Wat juist niet, bijv. "plakken" of "vleeswaren voor op brood" */
  avoid?: string | null;
  /** Andere varianten die je soms koopt, bijv. ["biologisch"] bij Bananen; elk krijgt een eigen tegel en wordt apart gezocht */
  variants?: string[];
  /** Titels van acties waarvan je zei "Klopt" of "Past niet"; de scan leert hiervan */
  likes?: string[];
  dislikes?: string[];
  /** Moment waarop je "Zoek nu" koos; de scan pakt dit product dan direct op */
  scanAt?: number | null;
  /** Aankoopmomenten (ms), nieuwste achteraan; hieruit leert Skwirl je koopritme */
  bought?: number[];
  /** Oud veld: handmatig ingesteld aantal dagen; alleen gebruikt zolang er te weinig aankopen zijn */
  interval?: number | null;
  /** Oud veld, niet meer gebruikt */
  target?: number | null;
  normal: number | null;
  lastBought: number | null;
  note: string | null;
}

export interface Household { version: 1; addresses: Address[]; stores: Store[]; chains: Record<string, { name: string; kind: Kind }>; products: Product[]; /** "Alles nu zoeken": start een volledige scan */ scanAllAt?: number | null }

export interface Deal {
  id: string;
  productId: string | null;
  /** Naam zoals in de folder, voor deals die (nog) niet aan een product hangen */
  title: string;
  chain: string;
  price: number | null;
  normal: number | null;
  mech: string;
  /** Eerste dag, 'YYYY-MM-DD'. Later dan vandaag = komt eraan (bijv. de folder van volgende week) */
  from: string | null;
  /** Laatste dag, 'YYYY-MM-DD' */
  until: string | null;
  /** Soort actie; 'dag' en 'weekend' gelden kort */
  span: 'week' | 'dag' | 'weekend' | null;
  /** Webshop bij chain 'online', bijv. "Douglas" */
  shop?: string | null;
  /** Waarom deze actie bij het product past, bijv. "Stuk jong belegen, geen plakken" */
  note?: string | null;
  /** Hoe zeker de koppeling aan het product is; bij twijfel toont de app "Misschien" */
  match?: 'zeker' | 'twijfel' | null;
  /** Inhoud per verpakking (multipacks opgeteld), bijv. 0.5 met unit 'kg' of 3 met unit 'l' */
  amount?: number | null;
  unit?: 'kg' | 'l' | null;
  /** Prijs per verpakking als je de actie benut, bijv. bij "2e halve prijs" 0,75 × de prijs */
  effPrice?: number | null;
  url: string | null;
}

/** Link naar de folder van een keten voor een bepaalde periode */
export interface FolderLink { chain: string; from: string | null; until: string | null; url: string }

export interface DealsFile { updatedAt: string | null; source: string | null; deals: Deal[]; folders?: FolderLink[] }
