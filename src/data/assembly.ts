/**
 * Assembly of flat-pack furniture and connection of appliances, per country and store, as the stores publish it
 * (checked 2026-11-22 on their own service pages). Most stores price assembly per piece only in the basket or on
 * request, so what is known is the least it costs: a call-out fee or a minimum order. Stores that publish nothing,
 * and those not checked because they answer scripts with a bot challenge, are listed as unknown with a link.
 */
export interface Assembly {
  /** one-off fee for the fitter's visit (zone 1 where the store has zones) */
  visit?: number;
  /** least a furniture assembly order costs */
  minimum?: number;
  /** plus a price for each piece, shown in the basket or when booking */
  perPiece?: boolean;
  /** kitchen assembly, a service of its own: the least it costs */
  kitchenFrom?: number;
  /** connecting an appliance, per device */
  connect?: Partial<Record<'washer' | 'oven', number>>;
  unknown?: boolean;
  note?: string;
  url: string;
}

const CHECKED = '2026-11-22';
export const ASSEMBLY_CHECKED = CHECKED;

export const ASSEMBLY: Record<string, Record<string, Assembly>> = {
  rs: {
    ik: {
      visit: 1999,
      perPiece: true,
      kitchenFrom: 4499,
      note: 'zone 1; zone 2 3,999, zone 3 4,999; the price per piece follows the work and shows in the basket',
      url: 'https://www.ikea.com/rs/sr/customer-service/services/assembly/sastavljanje-namestaja-pub26690660/',
    },
    emz: {
      unknown: true,
      note: 'by price list, after delivery only, within 100 km of a store',
      url: 'https://www.emmezeta.rs/kontakt-i-usluge/dostava-cesta-pitanja',
    },
    jysk: { unknown: true, url: 'https://jysk.rs/pravila-i-uslovi' },
    fi: { unknown: true, url: 'https://formaideale.rs/' },
    les: { unknown: true, url: 'https://www.xxxlesnina.rs/' },
    moe: { unknown: true, url: 'https://www.moemax.rs/' },
    giga: { unknown: true, url: 'https://gigatron.rs/cesta-pitanja' },
    ww: { unknown: true, url: 'https://www.winwin.rs/pages/cesta-pitanja' },
  },
  ba: {
    jysk: { unknown: true, url: 'https://jysk.ba/pravila-i-uslovi' },
    ts: { unknown: true, url: 'https://technoshop.ba/drustvo/22/dostava-i-isporuka' },
  },
  hr: {
    ikea: {
      visit: 70,
      perPiece: true,
      note: 'Zagreb and the coast; the price per piece follows the time it takes and is given when booking',
      url: 'https://www.ikea.com/hr/hr/customer-service/services/assembly/sastavljanje-namjestaja-pub9d558010/',
    },
    chip: { unknown: true, url: 'https://www.chipoteka.hr/cesta-pitanja' },
  },
  de: {
    ikea: {
      minimum: 39,
      perPiece: true,
      note: 'by Taskrabbit; the price per piece shows in the basket, travel included',
      url: 'https://www.ikea.com/de/de/customer-service/services/assembly/',
    },
    koeck: { unknown: true, url: 'https://www.elektrokoeck.com/de/Versand-und-Zahlung/' },
    td: { unknown: true, url: 'https://www.technikdirekt.de/' },
  },
  at: {
    ikea: {
      visit: 99,
      perPiece: true,
      note: 'kitchens: 79 € per ENHET or KNOXHULT cabinet, 99 € per METOD cabinet',
      url: 'https://www.ikea.com/at/de/customer-service/services/assembly/',
    },
    koeck: { unknown: true, note: 'assembly at extra cost, amount not given', url: 'https://www.elektrokoeck.com/de/Versand-und-Zahlung/' },
    neck: {
      connect: { washer: 29.99, oven: 79.9 },
      note: 'ordered together with the appliance; free-standing washers only',
      url: 'https://www.neckermann.at/technik-sperrgut-services/',
    },
  },
};
