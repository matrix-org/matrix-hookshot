import { OpenProjectWorkPackage } from "./Types";

export function workPackageToCacheState(
  pkg: OpenProjectWorkPackage,
): OpenProjectWorkPackageCacheState {
  return {
    subject: pkg.subject,
    description: pkg.description,
    status: pkg._embedded.status,
    assignee: pkg._embedded.assignee?.id,
    responsible: pkg._embedded.responsible?.id,
    priority: pkg._embedded.priority,
    type: pkg._embedded.type.id,
    project: pkg._embedded.project.id,
    dueDate: pkg.dueDate,
    percentageDone: pkg.percentageDone,
  };
}

export interface OpenProjectWorkPackageCacheState {
  subject: string;
  description: OpenProjectWorkPackage["description"];
  status: OpenProjectWorkPackage["_embedded"]["status"];
  assignee?: number;
  responsible?: number;
  priority?: OpenProjectWorkPackage["_embedded"]["priority"];
  type: number;
  project: number;
  dueDate: string | null;
  percentageDone: number | null;
}
