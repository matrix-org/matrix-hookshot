import { OpenProjectWorkPackage } from "./Types";

export function workPackageToCacheState(
  pkg: OpenProjectWorkPackage,
): OpenProjectWorkPackageCacheState {
  return {
    lockVersion: pkg.lockVersion,
    subject: pkg.subject,
    description: pkg.description,
    status: pkg._embedded.status,
    assignee: pkg._embedded.assignee?.id,
    responsible: pkg._embedded.responsible?.id,
    priority: pkg._embedded.priority,
    type: pkg._embedded.type.id,
    project: pkg._embedded.project.id,
    date: pkg.date,
    dueDate: pkg.dueDate,
    percentageDone: pkg.percentageDone,
  };
}

export interface OpenProjectWorkPackageCacheState {
  lockVersion: number;
  subject: string;
  description: OpenProjectWorkPackage["description"];
  status: OpenProjectWorkPackage["_embedded"]["status"];
  assignee?: number;
  responsible?: number;
  priority?: OpenProjectWorkPackage["_embedded"]["priority"];
  type: number;
  project: number;
  date: string | null;
  dueDate: string | null;
  percentageDone: number | null;
}
