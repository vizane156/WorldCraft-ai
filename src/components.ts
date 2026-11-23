import { Types, createComponent } from '@iwsdk/core';

export const WorldCraftItem = createComponent('WorldCraftItem', {
  objectId: { type: Types.String, default: '' },
  assetId: { type: Types.String, default: '' },
});
