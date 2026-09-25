import { styled } from "styled-components";

export const MessageCard = styled.div`
  a,
  a:visited {
    color: var(--cpd-color-text-link-external);
    text-decoration: none;
  }
`;

export const WorkPackageRoot = styled.div`
  margin-top: var(--cpd-space-1x);
  margin-bottom: var(--cpd-space-1x);
  gap: var(--cpd-space-2x);
  display: flex;
  flex-direction: column;
`;

export const StatusIndicator = styled.div`
  border-radius: 1em;
  width: 0.9em;
  height: 0.9em;
  display: inline-block;
  margin-right: var(--cpd-space-1x);
  background: var(--cpd-color-border-interactive-primary);
`;

export const WorkPackageRow = styled.div`
  gap: var(--cpd-space-4x);
  display: flex;
  flex-direction: row;
  color: var(--cpd-color-text-secondary);
  margin-top: auto;
  margin-bottom: auto;
`;

export const TitleLink = styled.a`
  font-weight: var(--cpd-font-weight-semibold);
`;

export const DescriptionText = styled.div`
  > p {
    margin: 0;
  }
`;

export const WorkPackageBorder = styled.div`
  width: var(--cpd-space-0-5x);
  height: auto;
  border-radius: var(--cpd-space-1x);
  background: var(--cpd-color-border-interactive-primary);
`;

export const WorkPackageWrapper = styled.div`
  display: flex;
  flex-direction: row;
  gap: var(--cpd-space-3x);
  margin-top: var(--cpd-space-2x);
  margin-bottom: var(--cpd-space-2x);
`;

export const WorkPackageChangedText = styled.div`
  color: var(--cpd-color-text-secondary);
`;
