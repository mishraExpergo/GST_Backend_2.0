import {
  renameConsideredInApiPayload,
  renameConsideredInToken,
} from './gst-terminology.util';

describe('gst-terminology.util', () => {
  it('renames considered tokens with case preserved', () => {
    expect(renameConsideredInToken('considered_state')).toBe('coapplicant_state');
    expect(renameConsideredInToken('considered_consent_available')).toBe(
      'coapplicant_consent_available',
    );
    expect(renameConsideredInToken('considered_entity_pan')).toBe(
      'coapplicant_entity_pan',
    );
    expect(renameConsideredInToken('consideredEntities')).toBe(
      'coapplicantEntities',
    );
    expect(renameConsideredInToken('CONSIDERED_TOTAL_GST_COUNT')).toBe(
      'COAPPLICANT_TOTAL_GST_COUNT',
    );
    expect(renameConsideredInToken('CONSIDERED_ENTITY')).toBe(
      'COAPPLICANT_ENTITY',
    );
  });

  it('deep-renames upload/mongo payload keys and string values', () => {
    const input = {
      id: 1,
      considered_state: 'MH',
      considered_consent_available: true,
      considered_entity_pan: 'ABCDE1234F',
      nested: {
        consideredEntities: [{ pan: 'X' }],
        entityType: 'CONSIDERED_ENTITY',
      },
      list: [{ considered_flag: 'yes' }],
    };

    expect(renameConsideredInApiPayload(input)).toEqual({
      id: 1,
      coapplicant_state: 'MH',
      coapplicant_consent_available: true,
      coapplicant_entity_pan: 'ABCDE1234F',
      nested: {
        coapplicantEntities: [{ pan: 'X' }],
        entityType: 'COAPPLICANT_ENTITY',
      },
      list: [{ coapplicant_flag: 'yes' }],
    });
  });
});
