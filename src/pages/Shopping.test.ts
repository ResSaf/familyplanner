import { describe, expect, it } from 'vitest'
import { itemsToText, suggestionsFor } from './Shopping'
import { suggest } from '../lib/suggest'
import type { Item } from '../api/types'

const item = (name: string, extra: Partial<Item> = {}): Item => ({ id: name, listId: 'l', name, checked: false, createdBy: 'x', ...extra })

describe('copy to clipboard text', () => {
  it('A7a: unchecked items only, one per line, note appended', () => {
    const text = itemsToText([item('Milk', { note: '2 pints' }), item('Bread'), item('Eggs', { checked: true }), item('Butter'), item('Jam', { checked: true })])
    expect(text).toBe('Milk 2 pints\nBread\nButter')
  })
  it('groups under category headings when categories are in use, uncategorised first', () => {
    const text = itemsToText([item('Milk', { category: 'Dairy' }), item('Candles'), item('Rolls', { category: 'Bakery' })])
    expect(text).toBe('Candles\n\nDairy\nMilk\n\nBakery\nRolls')
  })
})

describe('add-item suggestions', () => {
  const recent = ['Milk', 'Oat milk', 'Bread', 'Butter', 'Buttermilk', 'Eggs']
  it('offers nothing until something is typed, so focusing the box never opens a picker over the keyboard', () => {
    expect(suggestionsFor('', recent, [])).toEqual([])
    expect(suggestionsFor('  ', recent, [])).toEqual([])
  })
  it('puts starts-with matches before contains matches, case-insensitively', () => {
    expect(suggestionsFor('mil', recent, [])).toEqual(['Milk', 'Oat milk', 'Buttermilk'])
    expect(suggestionsFor('BU', recent, [])).toEqual(['Butter', 'Buttermilk'])
  })
  it('skips names already unchecked on the list and the exact text typed', () => {
    expect(suggestionsFor('milk', recent, [item('Oat milk')])).toEqual(['Buttermilk'])
    expect(suggestionsFor('milk', recent, [item('Oat milk', { checked: true })])).toEqual(['Oat milk', 'Buttermilk'])
  })
  it('caps the number shown', () => {
    expect(suggestionsFor('e', recent, [], 2)).toHaveLength(2)
  })
})

describe('shared suggest helper (note categories)', () => {
  it('offers nothing on an empty box and matches case-insensitively otherwise', () => {
    expect(suggest('', ['Appliances', 'Neighbours'])).toEqual([])
    expect(suggest('app', ['Appliances', 'Neighbours'])).toEqual(['Appliances'])
  })
})
