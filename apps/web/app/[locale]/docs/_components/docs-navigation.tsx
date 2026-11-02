import { ChevronDown } from 'lucide-react';

import { Cms } from '@kit/cms';
import { CollapsibleContent, CollapsibleTrigger } from '@kit/ui/collapsible';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from '@kit/ui/sidebar';

import { DocsNavLink } from '../_components/docs-nav-link';
import { DocsNavigationCollapsible } from '../_components/docs-navigation-collapsible';
import { FloatingDocumentationNavigationButton } from './floating-docs-navigation-button';

function Node({
  node,
  level,
  prefix,
}: {
  node: Cms.ContentItem;
  level: number;
  prefix: string;
}) {
  const url = `${prefix}/${node.slug}`;
  const label = node.label ? node.label : node.title;

  return (
    <NodeContainer node={node} prefix={prefix}>
      <NodeTrigger node={node} label={label} url={url} />

      <NodeContentContainer node={node}>
        <Tree pages={node.children ?? []} level={level + 1} prefix={prefix} />
      </NodeContentContainer>
    </NodeContainer>
  );
}

function NodeContentContainer({
  node,
  children,
}: {
  node: Cms.ContentItem;
  children: React.ReactNode;
}) {
  if (node.collapsible) {
    return <CollapsibleContent>{children}</CollapsibleContent>;
  }

  return children;
}

function NodeContainer({
  node,
  prefix,
  children,
}: {
  node: Cms.ContentItem;
  prefix: string;
  children: React.ReactNode;
}) {
  if (node.collapsible) {
    return (
      <DocsNavigationCollapsible node={node} prefix={prefix}>
        {children}
      </DocsNavigationCollapsible>
    );
  }

  return children;
}

function NodeTrigger({
  node,
  label,
  url,
}: {
  node: Cms.ContentItem;
  label: string;
  url: string;
}) {
  if (node.collapsible) {
    return (
      <CollapsibleTrigger render={<SidebarMenuItem />}>
        <SidebarMenuButton>
          {label}
          <ChevronDown className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-180" />
        </SidebarMenuButton>
      </CollapsibleTrigger>
    );
  }

  return <DocsNavLink label={label} url={url} />;
}

function Tree({
  pages,
  level,
  prefix,
}: {
  pages: Cms.ContentItem[];
  level: number;
  prefix: string;
}) {
  if (level === 0) {
    return pages.map((treeNode, index) => (
      <Node key={index} node={treeNode} level={level} prefix={prefix} />
    ));
  }

  if (pages.length === 0) {
    return null;
  }

  return (
    <SidebarMenuSub>
      {pages.map((treeNode, index) => (
        <Node key={index} node={treeNode} level={level} prefix={prefix} />
      ))}
    </SidebarMenuSub>
  );
}

export function DocsNavigation({
  pages,
  prefix = '/docs',
}: {
  pages: Cms.ContentItem[];
  prefix?: string;
}) {
  return (
    <>
      <Sidebar variant={'sidebar'}>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu className={'pb-48'}>
                <Tree pages={pages} level={0} prefix={prefix} />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <FloatingDocumentationNavigationButton />
    </>
  );
}
