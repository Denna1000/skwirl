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
  cat: string;
  /** Waar het te koop is; leeg = maakt niet uit */
  where: Kind[];
  loose: boolean;
  /** Dagen dat één keer kopen meegaat */
  interval: number;
  /** Doelprijs per stuk/verpakking in euro's, of null */
  target: number | null;
  normal: number | null;
  lastBought: number | null;
  note: string | null;
}

export interface Household { version: 1; addresses: Address[]; stores: Store[]; chains: Record<string, { name: string; kind: Kind }>; products: Product[] }

export interface Deal {
  id: string;
  productId: string | null;
  /** Naam zoals in de folder, voor deals die (nog) niet aan een product hangen */
  title: string;
  chain: string;
  price: number | null;
  normal: number | null;
  mech: string;
  until: string | null;
  url: string | null;
}

export interface DealsFile { updatedAt: string | null; source: string | null; deals: Deal[] }
