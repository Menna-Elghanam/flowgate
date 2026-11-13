import type { RequestStatus, TaskStatus } from '@flowgate/workflow';
import { REQUEST_STATUS_LABEL, STATUS_TONE, TASK_STATUS_LABEL } from '@/lib/format';
import { Badge } from './ui';

export const RequestStatusBadge = ({ status }: { status: RequestStatus }) => (
  <Badge tone={STATUS_TONE[status]}>{REQUEST_STATUS_LABEL[status]}</Badge>
);

export const TaskStatusBadge = ({ status }: { status: TaskStatus }) => (
  <Badge tone={STATUS_TONE[status]}>{TASK_STATUS_LABEL[status]}</Badge>
);
