import { AAT } from './vocab.js';

// Small builders for Linked Art nodes. They only shape data the source gave us;
// callers skip a builder entirely when the source lacks the value.

export const LA_CONTEXT = 'https://linked.art/ns/v1/linked-art.json';

const type = (id: string, label?: string) => ({ id, type: 'Type', ...(label ? { _label: label } : {}) });

export function primaryName(content: string) {
  return { type: 'Name', content, classified_as: [type(AAT.primaryName, 'Primary Name')] };
}

export function accessionNumber(content: string) {
  return { type: 'Identifier', content, classified_as: [type(AAT.accessionNumber, 'Accession Number')] };
}

export function statement(content: string, statementType: string, label: string) {
  return {
    type: 'LinguisticObject',
    content,
    classified_as: [{ ...type(statementType, label), classified_as: [type(AAT.briefText, 'Brief Text')] }],
  };
}

/** A year range as a TimeSpan. Years are as the source states them; no rounding or guessing. */
export function yearSpan(begin: number, end: number, display?: string) {
  return {
    type: 'TimeSpan',
    ...(display ? { identified_by: [{ type: 'Name', content: display }] } : {}),
    begin_of_the_begin: `${String(begin).padStart(4, '0')}-01-01T00:00:00Z`,
    end_of_the_end: `${String(end).padStart(4, '0')}-12-31T23:59:59Z`,
  };
}

export function dimension(value: number, dimType: 'height' | 'width' | 'depth', unit: string, unitLabel: string) {
  return {
    type: 'Dimension',
    value,
    classified_as: [type(AAT[dimType], dimType)],
    unit: { id: unit, type: 'MeasurementUnit', _label: unitLabel },
  };
}

export function webPage(url: string) {
  return {
    type: 'LinguisticObject',
    digitally_carried_by: [
      { type: 'DigitalObject', classified_as: [type(AAT.webPage, 'Web Page')], format: 'text/html', access_point: [{ id: url, type: 'DigitalObject' }] },
    ],
  };
}

/** A representation pointing at an image, optionally through a IIIF service. */
export function imageRepresentation(url: string, opts: { iiifService?: string } = {}) {
  return {
    type: 'VisualItem',
    digitally_shown_by: [
      {
        type: 'DigitalObject',
        classified_as: [type(AAT.digitalImage, 'Digital Image')],
        access_point: [{ id: url, type: 'DigitalObject' }],
        ...(opts.iiifService
          ? { digitally_available_via: [{ type: 'DigitalService', access_point: [{ id: opts.iiifService, type: 'DigitalObject' }], conforms_to: [{ id: 'http://iiif.io/api/image', type: 'InformationObject' }] }] }
          : {}),
      },
    ],
  };
}

export function wikidataEntity(qid: string) {
  return `http://www.wikidata.org/entity/${qid}`;
}

/** Drop empty strings, nulls and empty arrays so unmapped lists only show real values. */
export function present(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== '' && v !== null && v !== undefined && !(Array.isArray(v) && !v.length)),
  );
}
