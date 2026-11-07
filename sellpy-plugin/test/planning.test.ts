import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imagePlan, stylePlan } from '../src/planning.js';
import { inputSchemas } from '../src/schemas.js';

test('mislabel recovery removes source taxonomy while retaining true intent and budget', () => {
  const plan = stylePlan(inputSchemas.search_style.parse({
    query:'Cottagecore Kleid', style:'cottagecore', desired_type:'dress',
    attribute_queries:['floral dress with puff sleeves'], relaxed_queries:['tiny floral print puff sleeves lace trim'],
    filters:{price_max:35,facets:{'categories.lvl1':['Damen > Kleider'],style:['cottagecore'],size:['M'],material:['Baumwolle']}},
    exclude:['transparent'],
  }));
  const relaxed=plan.arms.filter(arm=>arm.category_relaxed);
  assert.ok(relaxed.length>=2);
  for (const arm of relaxed) {
    assert.equal(arm.filters?.facets?.['categories.lvl1'],undefined);
    assert.equal(arm.filters?.facets?.style,undefined);
    assert.deepEqual(arm.filters?.facets?.size,['M']);
    assert.equal(arm.filters?.price_max,35);
    assert.ok(!arm.query?.includes('dress'));
  }
  assert.equal(plan.intent.desired_type,'dress');
  assert.equal(plan.intent.style,'cottagecore');
  assert.deepEqual(plan.intent.exclude,['transparent']);
});

test('image edits combine native visual retrieval with separately inspectable text routes', () => {
  const plan=imagePlan(inputSchemas.search_by_image.parse({ image_url:'https://prod.images.sellpy.net/item.jpg',
    desired_type:'dress', modification:'similar but long sleeves', attribute_queries:['floral dress long sleeves'] }));
  assert.ok(plan.arms.some(arm=>arm.route==='image'));
  assert.ok(plan.arms.some(arm=>arm.route==='semantic' && arm.query?.includes('long sleeves')));
  assert.equal(plan.intent.modification,'similar but long sleeves');
});

test('identical strict and relaxed requests do not spend two calls or gain two fusion votes', () => {
  const plan = stylePlan(inputSchemas.search_style.parse({ query: 'floral puff sleeves', style: 'floral puff sleeves',
    desired_type: 'dress', attribute_queries: ['floral puff sleeves'], relaxed_queries: ['floral puff sleeves'],
    filters: { price_max: 35, facets: { 'metadata.size': ['WMN-INT-M'] } } }));
  assert.equal(plan.arms.length, 2);
  assert.deepEqual(plan.arms.map(arm => arm.route).sort(), ['catalog', 'semantic']);
  assert(plan.arms.every(arm => arm.category_relaxed === true));
  assert.equal(plan.intent.desired_type, 'dress');
  assert(plan.arms.every(arm => arm.filters?.price_max === 35));
});

test('different taxonomy filters retain independent strict and relaxed search arms', () => {
  const plan = stylePlan(inputSchemas.search_style.parse({ query: 'floral puff sleeves', style: 'floral puff sleeves',
    attribute_queries: ['floral puff sleeves'], relaxed_queries: ['floral puff sleeves'],
    filters: { facets: { 'metadata.type': ['Dress'], style: ['Cottagecore'] } } }));
  assert.equal(plan.arms.length, 4);
  assert.equal(plan.arms.filter(arm => arm.category_relaxed).length, 2);
  assert.equal(plan.arms.filter(arm => !arm.category_relaxed).length, 2);
});
