/**
 * Home delivery of a furniture order, per country and store, as published on the stores' delivery pages
 * (checked 2026-11-03). Prices are for delivery of large items to the address; "from" means the store adds
 * zones, weight or size on top, so the amount is the least it costs. Stores that only show the price in the
 * basket, or answer with a bot challenge, are listed as unknown with a link instead of a guess.
 */
export interface Delivery {
  /** flat fee, or the fee for the first large item */
  fee?: number;
  /** each further large item from the same store */
  perExtra?: number;
  /** fee by order value: [up to, fee]; the last tier has no upper limit */
  tiers?: [number, number][];
  /** free from this order value */
  freeFrom?: number;
  from?: boolean;
  unknown?: boolean;
  note?: string;
  url: string;
}

const CHECKED = '2026-11-03';
export const DELIVERY_CHECKED = CHECKED;

export const DELIVERY: Record<string, Record<string, Delivery>> = {
  rs: {
    ik: { fee: 1999, from: true, note: 'truck to the building, zone 1', url: 'https://www.ikea.com/rs/sr/customer-service/services/delivery/' },
    jysk: { unknown: true, url: 'https://jysk.rs/pravila-i-uslovi#5' },
    fi: { unknown: true, url: 'https://formaideale.rs/' },
    les: { unknown: true, url: 'https://www.xxxlesnina.rs/' },
    moe: { unknown: true, url: 'https://www.moemax.rs/' },
    emz: { fee: 600, from: true, note: 'up to 30 kg; heavier orders by weight and distance', url: 'https://www.emmezeta.rs/kontakt-i-usluge/dostava-cesta-pitanja' },
    giga: { fee: 2399, perExtra: 1199, note: 'large appliances', url: 'https://gigatron.rs/isporuka' },
  },
  ba: {
    jysk: { fee: 7, from: true, freeFrom: 600, url: 'https://jysk.ba/pravila-i-uslovi' },
    ts: { fee: 10, url: 'https://technoshop.ba/drustvo/22/dostava-i-isporuka' },
  },
  hr: {
    ikea: { fee: 59.99, from: true, note: 'to the driveway, zone 1, up to 100 kg', url: 'https://www.ikea.com/hr/hr/customer-service/services/delivery/' },
  },
  de: {
    ikea: { tiers: [[400, 89], [1000, 99], [Infinity, 159]], note: 'to a room of your choice', url: 'https://www.ikea.com/de/de/customer-service/services/delivery/' },
  },
  at: {
    ikea: { tiers: [[149.99, 39], [499.99, 49], [999.99, 99], [1499.99, 149], [Infinity, 249]], note: 'to a room of your choice', url: 'https://www.ikea.com/at/de/customer-service/services/delivery/' },
  },
};
