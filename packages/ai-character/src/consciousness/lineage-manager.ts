/**
 * Lineage Manager
 *
 * Handles family tree queries, ancestor/descendant tracking,
 * and relationship detection for preventing inbreeding.
 */

import { db, schema } from '@maldoror/db';
import { eq, or, and, ne } from 'drizzle-orm';
import type { LifecycleStage } from './types.js';

export interface FamilyMember {
  id: string;
  name: string;
  relationship: 'parent' | 'child' | 'sibling' | 'grandparent' | 'grandchild' | 'aunt_uncle' | 'niece_nephew' | 'cousin';
  stage: LifecycleStage;
  isAlive: boolean;
}

export interface FamilyTree {
  npcId: string;
  npcName: string;
  generation: number;
  familyName?: string;
  parents: FamilyMember[];
  siblings: FamilyMember[];
  children: FamilyMember[];
  grandparents: FamilyMember[];
  grandchildren: FamilyMember[];
  auntsUncles: FamilyMember[];
  niecesNephews: FamilyMember[];
  cousins: FamilyMember[];
}

export class LineageManager {
  /**
   * Get all immediate family members (parents, siblings, children)
   */
  async getImmediateFamily(npcId: string): Promise<FamilyMember[]> {
    const family: FamilyMember[] = [];

    // Get this NPC's lineage
    const [myLineage] = await db
      .select()
      .from(schema.npcLineage)
      .innerJoin(schema.users, eq(schema.npcLineage.npcId, schema.users.id))
      .where(eq(schema.npcLineage.npcId, npcId))
      .limit(1);

    if (!myLineage) return family;

    // Get parents
    if (myLineage.npc_lineage.parent1Id) {
      const parent = await this.getMemberInfo(myLineage.npc_lineage.parent1Id, 'parent');
      if (parent) family.push(parent);
    }
    if (myLineage.npc_lineage.parent2Id) {
      const parent = await this.getMemberInfo(myLineage.npc_lineage.parent2Id, 'parent');
      if (parent) family.push(parent);
    }

    // Get siblings (share at least one parent)
    const parentIds = [myLineage.npc_lineage.parent1Id, myLineage.npc_lineage.parent2Id].filter(Boolean);
    if (parentIds.length > 0) {
      const siblings = await db
        .select()
        .from(schema.npcLineage)
        .innerJoin(schema.users, eq(schema.npcLineage.npcId, schema.users.id))
        .where(
          and(
            ne(schema.npcLineage.npcId, npcId),
            or(
              parentIds[0] ? eq(schema.npcLineage.parent1Id, parentIds[0]) : undefined,
              parentIds[0] ? eq(schema.npcLineage.parent2Id, parentIds[0]) : undefined,
              parentIds[1] ? eq(schema.npcLineage.parent1Id, parentIds[1]) : undefined,
              parentIds[1] ? eq(schema.npcLineage.parent2Id, parentIds[1]) : undefined
            )
          )
        );

      for (const sib of siblings) {
        family.push({
          id: sib.npc_lineage.npcId,
          name: sib.users.username,
          relationship: 'sibling',
          stage: sib.npc_lineage.lifecycleStage as LifecycleStage,
          isAlive: !sib.npc_lineage.deathAt,
        });
      }
    }

    // Get children (where I am a parent)
    const children = await db
      .select()
      .from(schema.npcLineage)
      .innerJoin(schema.users, eq(schema.npcLineage.npcId, schema.users.id))
      .where(
        or(
          eq(schema.npcLineage.parent1Id, npcId),
          eq(schema.npcLineage.parent2Id, npcId)
        )
      );

    for (const child of children) {
      family.push({
        id: child.npc_lineage.npcId,
        name: child.users.username,
        relationship: 'child',
        stage: child.npc_lineage.lifecycleStage as LifecycleStage,
        isAlive: !child.npc_lineage.deathAt,
      });
    }

    return family;
  }

  /**
   * Get full family tree including extended family
   */
  async getFullFamilyTree(npcId: string): Promise<FamilyTree | null> {
    // Get base info
    const [myLineage] = await db
      .select()
      .from(schema.npcLineage)
      .innerJoin(schema.users, eq(schema.npcLineage.npcId, schema.users.id))
      .where(eq(schema.npcLineage.npcId, npcId))
      .limit(1);

    if (!myLineage) return null;

    const tree: FamilyTree = {
      npcId,
      npcName: myLineage.users.username,
      generation: myLineage.npc_lineage.generation,
      familyName: myLineage.npc_lineage.familyName || undefined,
      parents: [],
      siblings: [],
      children: [],
      grandparents: [],
      grandchildren: [],
      auntsUncles: [],
      niecesNephews: [],
      cousins: [],
    };

    // Get immediate family first
    const immediate = await this.getImmediateFamily(npcId);
    tree.parents = immediate.filter(m => m.relationship === 'parent');
    tree.siblings = immediate.filter(m => m.relationship === 'sibling');
    tree.children = immediate.filter(m => m.relationship === 'child');

    // Get grandparents (parents of parents)
    for (const parent of tree.parents) {
      const parentFamily = await this.getImmediateFamily(parent.id);
      for (const grandparent of parentFamily.filter(m => m.relationship === 'parent')) {
        if (!tree.grandparents.find(g => g.id === grandparent.id)) {
          tree.grandparents.push({ ...grandparent, relationship: 'grandparent' });
        }
      }
      // Aunts/uncles are siblings of parents
      for (const auntUncle of parentFamily.filter(m => m.relationship === 'sibling')) {
        if (!tree.auntsUncles.find(a => a.id === auntUncle.id)) {
          tree.auntsUncles.push({ ...auntUncle, relationship: 'aunt_uncle' });
        }
      }
    }

    // Get grandchildren (children of children)
    for (const child of tree.children) {
      const childFamily = await this.getImmediateFamily(child.id);
      for (const grandchild of childFamily.filter(m => m.relationship === 'child')) {
        if (!tree.grandchildren.find(g => g.id === grandchild.id)) {
          tree.grandchildren.push({ ...grandchild, relationship: 'grandchild' });
        }
      }
    }

    // Nieces/nephews (children of siblings)
    for (const sibling of tree.siblings) {
      const sibFamily = await this.getImmediateFamily(sibling.id);
      for (const nieceNephew of sibFamily.filter(m => m.relationship === 'child')) {
        if (!tree.niecesNephews.find(n => n.id === nieceNephew.id)) {
          tree.niecesNephews.push({ ...nieceNephew, relationship: 'niece_nephew' });
        }
      }
    }

    // Cousins (children of aunts/uncles)
    for (const auntUncle of tree.auntsUncles) {
      const auFamily = await this.getImmediateFamily(auntUncle.id);
      for (const cousin of auFamily.filter(m => m.relationship === 'child')) {
        if (!tree.cousins.find(c => c.id === cousin.id)) {
          tree.cousins.push({ ...cousin, relationship: 'cousin' });
        }
      }
    }

    return tree;
  }

  /**
   * Check if two NPCs can mate (not closely related)
   * Prevents inbreeding by checking for close family relations
   */
  async canMate(npc1Id: string, npc2Id: string): Promise<{ canMate: boolean; reason?: string }> {
    // Same person check
    if (npc1Id === npc2Id) {
      return { canMate: false, reason: 'Cannot mate with self' };
    }

    // Get family trees for both
    const tree1 = await this.getFullFamilyTree(npc1Id);
    const tree2 = await this.getFullFamilyTree(npc2Id);

    if (!tree1 || !tree2) {
      // If no lineage exists, they're first-gen NPCs, can mate
      return { canMate: true };
    }

    // Check if npc2 is in npc1's immediate family
    const allFamily1 = [
      ...tree1.parents,
      ...tree1.siblings,
      ...tree1.children,
      ...tree1.grandparents,
      ...tree1.grandchildren,
      ...tree1.auntsUncles,
      ...tree1.niecesNephews,
    ];

    for (const member of allFamily1) {
      if (member.id === npc2Id) {
        return {
          canMate: false,
          reason: `Cannot mate with ${member.relationship.replace('_', '/')}`,
        };
      }
    }

    // Cousins can mate (though unusual)
    // If we want to prevent cousin mating, uncomment:
    // for (const cousin of tree1.cousins) {
    //   if (cousin.id === npc2Id) {
    //     return { canMate: false, reason: 'Cannot mate with cousin' };
    //   }
    // }

    return { canMate: true };
  }

  /**
   * Get all family member IDs for an NPC (for death notifications)
   */
  async getAllFamilyIds(npcId: string): Promise<string[]> {
    const tree = await this.getFullFamilyTree(npcId);
    if (!tree) return [];

    const allMembers = [
      ...tree.parents,
      ...tree.siblings,
      ...tree.children,
      ...tree.grandparents,
      ...tree.grandchildren,
      ...tree.auntsUncles,
      ...tree.niecesNephews,
      ...tree.cousins,
    ];

    return [...new Set(allMembers.map(m => m.id))];
  }

  /**
   * Format family info for LLM context
   */
  formatFamilyForContext(tree: FamilyTree): string {
    const lines: string[] = [];

    if (tree.familyName) {
      lines.push(`Family: The ${tree.familyName} family (generation ${tree.generation})`);
    }

    if (tree.parents.length > 0) {
      const parentNames = tree.parents.map(p =>
        `${p.name}${p.isAlive ? '' : ' (deceased)'}`
      ).join(' and ');
      lines.push(`Parents: ${parentNames}`);
    }

    if (tree.siblings.length > 0) {
      const sibNames = tree.siblings.map(s =>
        `${s.name}${s.isAlive ? '' : ' (deceased)'}`
      ).join(', ');
      lines.push(`Siblings: ${sibNames}`);
    }

    if (tree.children.length > 0) {
      const childNames = tree.children.map(c =>
        `${c.name}${c.isAlive ? '' : ' (deceased)'}`
      ).join(', ');
      lines.push(`Children: ${childNames}`);
    }

    if (tree.grandparents.length > 0) {
      const gpNames = tree.grandparents.map(g =>
        `${g.name}${g.isAlive ? '' : ' (deceased)'}`
      ).join(', ');
      lines.push(`Grandparents: ${gpNames}`);
    }

    if (lines.length === 0) {
      return 'No known family members.';
    }

    return lines.join('\n');
  }

  private async getMemberInfo(
    npcId: string,
    relationship: FamilyMember['relationship']
  ): Promise<FamilyMember | null> {
    const [lineage] = await db
      .select()
      .from(schema.npcLineage)
      .innerJoin(schema.users, eq(schema.npcLineage.npcId, schema.users.id))
      .where(eq(schema.npcLineage.npcId, npcId))
      .limit(1);

    if (!lineage) return null;

    return {
      id: lineage.npc_lineage.npcId,
      name: lineage.users.username,
      relationship,
      stage: lineage.npc_lineage.lifecycleStage as LifecycleStage,
      isAlive: !lineage.npc_lineage.deathAt,
    };
  }
}

export const lineageManager = new LineageManager();
