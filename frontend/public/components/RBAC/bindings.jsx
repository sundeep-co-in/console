import React from 'react';
import Helmet from 'react-helmet';
import { connect } from 'react-redux';
import { Link } from 'react-router';

import { k8s, k8sCreate, k8sKinds, k8sPatch } from '../../module/k8s';
import { util } from '../../module/k8s/util';
import { getActiveNamespace, getNamespacedRoute, actions as UIActions } from '../../ui/ui-actions';
import { MultiListPage, List } from '../factory';
import { RadioGroup } from '../modals/_radio';
import { confirmModal } from '../modals';
import { SafetyFirst } from '../safety-first';
import { ButtonBar, Cog, Dropdown, Firehose, history, kindObj, LoadingInline, MsgBox, MultiFirehose, ResourceCog, ResourceName, ResourceLink, StatusBox } from '../utils';
import { isSystemRole } from './index';

const bindingKind = binding => binding.metadata.namespace ? 'rolebinding' : 'clusterrolebinding';

const k8sKind = kindId => _.get(k8sKinds, `${_.toUpper(kindId)}.kind`);

// Split each binding into one row per subject
const rowSplitter = binding => {
  if (!binding) {
    return undefined;
  }
  if (_.isEmpty(binding.subjects)) {
    const subject = {kind: '-', name: '-'};
    return [Object.assign({}, binding, {subject})];
  }
  return binding.subjects.map(subject => Object.assign({}, binding, {subject}));
};

const menuActions = (subjectIndex, isBindingDelete) => [
  (kind, obj) => ({
    label: `Duplicate ${kind.label}...`,
    weight: 700,
    href: `${util.getLink(obj, kind)}/copy?subjectIndex=${subjectIndex}`,
  }),
  (kind, obj) => ({
    label: `Edit ${kind.label} Subject...`,
    weight: 800,
    href: `${util.getLink(obj, kind)}/edit?subjectIndex=${subjectIndex}`,
  }),
  isBindingDelete ? Cog.factory.Delete : (kind, binding) => {
    const subject = binding.subjects[subjectIndex];
    return {
      label: `Delete ${kind.label} Subject...`,
      weight: 900,
      callback: () => confirmModal({
        title: `Delete ${kind.label} Subject`,
        message: `Are you sure you want to delete subject ${subject.name} of type ${subject.kind}?`,
        btnText: 'Delete Subject',
        executeFn: () => k8s[kind.plural].patch(binding, [{op: 'remove', path: `/subjects/${subjectIndex}`}]),
      }),
    };
  },
];

const Header = () => <div className="row co-m-table-grid__head">
  <div className="col-xs-3">Name</div>
  <div className="col-xs-3">Role Ref</div>
  <div className="col-xs-6">
    <div className="col-xs-3">Subject Kind</div>
    <div className="col-xs-5">Subject Name</div>
    <div className="col-xs-4">Namespace</div>
  </div>
</div>;

export const BindingName = ({actions, binding}) => <span>
  <ResourceCog actions={actions} kind={bindingKind(binding)} resource={binding} />
  <ResourceName kind={bindingKind(binding)} name={binding.metadata.name} />
</span>;

export const RoleLink = ({binding}) => {
  const kind = binding.roleRef.kind.toLowerCase();

  // Cluster Roles have no namespace and for Roles, the Role's namespace matches the Role Binding's namespace
  const ns = kind === 'clusterrole' ? undefined : binding.metadata.namespace;
  return <ResourceLink kind={kind} name={binding.roleRef.name} namespace={ns} />;
};

const SubjectRow = ({actions, binding, kind, name}) => {
  return <div className="row co-resource-list__item">
    <div className="col-xs-3">
      <BindingName actions={actions} binding={binding} />
    </div>
    <div className="col-xs-3">
      <RoleLink binding={binding} />
    </div>
    <div className="col-xs-6">
      <div className="col-xs-3">
        {kind}
      </div>
      <div className="col-xs-5">
        {name}
      </div>
      <div className="col-xs-4">
        {binding.metadata.namespace ? <ResourceLink kind="namespace" name={binding.metadata.namespace} /> : 'all'}
      </div>
    </div>
  </div>;
};

export const BindingRows = Row => ({obj: binding}) => {
  const rows = rowSplitter(binding);
  return <div>
    {rows.map(({subject}, i) => <Row
      key={i}
      actions={menuActions(i, rows.length === 1)}
      binding={binding}
      kind={subject.kind}
      name={subject.name}
    />)}
  </div>;
};

export const EmptyMsg = <MsgBox title="No Role Bindings Found" detail="Roles grant access to types of objects in the cluster. Roles are applied to a group or user via a Role Binding." />;

const BindingsList = props => <List {...props} EmptyMsg={EmptyMsg} Header={Header} Row={BindingRows(SubjectRow)} />;

export const bindingType = binding => {
  if (!binding) {
    return undefined;
  }
  if (binding.roleRef.name.startsWith('system:')) {
    return 'system';
  }
  return binding.metadata.namespace ? 'namespace' : 'cluster';
};

const filters = [{
  type: 'role-binding-kind',
  selected: ['cluster', 'namespace'],
  reducer: bindingType,
  items: ({clusterrolebinding: data}) => {
    const items = [
      {id: 'namespace', title: 'Namespace Role Bindings'},
      {id: 'system', title: 'System Role Bindings'},
    ];
    if (data && data.loaded && !data.loadError) {
      items.unshift({id: 'cluster', title: 'Cluster-wide Role Bindings'});
    }
    return items;
  },
}];

const resources = [
  {kind: 'rolebinding', namespaced: true},
  {kind: 'clusterrolebinding', namespaced: false},
];

export const RoleBindingsPage = () => <MultiListPage
  ListComponent={BindingsList}
  canCreate={true}
  createButtonText="Create Binding"
  createProps={{to: 'rolebindings/new'}}
  filterLabel="Role Bindings by role or subject"
  resources={resources}
  rowFilters={filters}
  rowSplitter={rowSplitter}
  textFilter="role-binding"
  title="Role Bindings"
/>;

const ListDropdown_ = ({desc, fixedKey, loaded, loadError, onChange, placeholder, resources, selectedKey}) => {
  let items, title, newOnChange;
  if (loadError) {
    title = <div className="cos-error-title">Error Loading {desc}</div>;
  } else if (!loaded) {
    title = <LoadingInline />;
  } else {
    const resourceNameKindMap = ({data, kind}) => _.reject(data, isSystemRole).map(d => ({[d.metadata.name]: kind}));
    const nameKindMap = Object.assign({}, ..._.flatMap(resources, resourceNameKindMap));
    items = _.mapValues(nameKindMap, (kind, name) => <ResourceName kind={kind} name={name} />);
    title = items[selectedKey] || <span className="text-muted">{placeholder}</span>;

    // Pass both the resource name and the resource kind to onChange()
    newOnChange = key => onChange(key, nameKindMap[key]);
  }
  return <div>
    {_.has(items, fixedKey) ? items[fixedKey] : <Dropdown items={items} title={title} onChange={newOnChange} />}
    {loaded && _.isEmpty(items) && <p className="alert alert-info">No {desc} found or defined.</p>}
  </div>;
};

const ListDropdown = props => <MultiFirehose resources={props.kinds.map(kind => ({kind, isList: true, prop: kind}))}>
  <ListDropdown_ {...props} />
</MultiFirehose>;

const NsDropdown = props => <ListDropdown {...props} desc="Namespaces" kinds={['namespace']} placeholder="Select namespace" />;

const NsRoleDropdown = props => <ListDropdown
  {...props}
  desc="Namespace Roles (Role)"
  kinds={props.fixedKind ? [_.toLower(props.fixedKind)] : ['role', 'clusterrole']}
  placeholder="Select role name"
/>;

const ClusterRoleDropdown = props => <ListDropdown {...props} desc="Cluster-wide Roles (ClusterRole)" kinds={['clusterrole']} placeholder="Select role name" />;

const bindingKinds = [
  {value: 'RoleBinding', title: 'Namespace Role Binding (RoleBinding)', desc: 'Grant the permissions to a user or set of users within the selected namespace.'},
  {value: 'ClusterRoleBinding', title: 'Cluster-wide Role Binding (ClusterRoleBinding)', desc: 'Grant the permissions to a user or set of users at the cluster level and in all namespaces.'},
];
const subjectKinds = [
  {value: 'User', title: 'User'},
  {value: 'Group', title: 'Group'},
  {value: 'ServiceAccount', title: 'Service Account'},
];

const Section = ({label, children}) => <div className="row">
  <div className="col-xs-2">
    <label>{label}:</label>
  </div>
  <div className="col-xs-10">
    {children}
  </div>
</div>;

const BaseEditRoleBinding = connect()(
class BaseEditRoleBinding_ extends SafetyFirst {
  constructor (props) {
    super(props);

    this.subjectIndex = props.subjectIndex || 0;

    const existingData = _.pick(props, ['kind', 'metadata.name', 'metadata.namespace', 'roleRef', 'subjects']);
    const data = _.defaultsDeep({}, props.fixed, existingData, {
      apiVersion: 'rbac.authorization.k8s.io/v1beta1',
      kind: 'RoleBinding',
      metadata: {
        name: '',
      },
      roleRef: {
        apiGroup: 'rbac.authorization.k8s.io',
      },
      subjects: [{
        apiGroup: 'rbac.authorization.k8s.io',
        kind: 'User',
        name: '',
      }],
    });
    this.state = {data, inProgress: false};

    this.setKind = this.setKind.bind(this);
    this.setSubject = this.setSubject.bind(this);
    this.save = this.save.bind(this);

    this.setData = patch => this.setState({data: _.defaultsDeep({}, patch, this.state.data)});
    this.changeName = e => this.setData({metadata: {name: e.target.value}});
    this.changeNamespace = namespace => this.setData({metadata: {namespace}});
    this.changeRoleRef = (name, kindId) => this.setData({roleRef: {name, kind: k8sKind(kindId)}});
    this.changeSubjectKind = e => this.setSubject({kind: e.target.value});
    this.changeSubjectName = e => this.setSubject({name: e.target.value});
    this.changeSubjectNamespace = namespace => this.setSubject({namespace});
  }

  setKind (e) {
    const kind = e.target.value;
    const patch = {kind};
    if (kind === 'ClusterRoleBinding') {
      patch['metadata'] = {namespace: null};
    }
    this.setData(patch);
  }

  getSubject () {
    return _.get(this.state.data, `subjects[${this.subjectIndex}]`);
  }

  setSubject (patch) {
    const {kind, name, namespace} = Object.assign({}, this.getSubject(), patch);
    const data = Object.assign({}, this.state.data);
    data.subjects[this.subjectIndex] = kind === 'ServiceAccount' ? {kind, name, namespace} : {apiGroup: 'rbac.authorization.k8s.io', kind, name};
    this.setState({data});
  }

  save () {
    const {kind, metadata, roleRef} = this.state.data;
    const subject = this.getSubject();

    if (!kind || !metadata.name || !roleRef.kind || !roleRef.name || !subject.kind || !subject.name ||
      (kind === 'RoleBinding' && !metadata.namespace) ||
      (subject.kind === 'ServiceAccount') && !subject.namespace) {
      this.setState({error: 'Please complete all fields.'});
      return;
    }

    this.setState({inProgress: true});

    const ko = kindObj(kind);
    (this.props.isCreate
      ? k8sCreate(ko, this.state.data)
      : k8sPatch(ko, {metadata}, [{op: 'replace', path: `/subjects/${this.subjectIndex}`, value: subject}])
    ).then(
      () => {
        this.setState({inProgress: false});
        if (metadata.namespace) {
          this.props.dispatch(UIActions.setActiveNamespace(metadata.namespace));
        }
        history.push(getNamespacedRoute('rolebindings'));
      },
      e => this.setState({error: e.message, inProgress: false})
    );
  }

  render () {
    const {kind, metadata, roleRef} = this.state.data;
    const subject = this.getSubject();
    const {fixed, title} = this.props;
    const RoleDropdown = kind === 'RoleBinding' ? NsRoleDropdown : ClusterRoleDropdown;

    return <div className="rbac-edit-binding co-m-pane__body">
      <Helmet title={title} />
      <div className="co-m-pane__body-group">
        <h1 className="co-m-pane__title">{title}</h1>
        <div className="co-m-pane__explanation">Associate a user/group to the selected role to define the type of access and resources that are allowed.</div>

        {!_.get(fixed, 'kind') && <RadioGroup currentValue={kind} items={bindingKinds} onChange={this.setKind} />}

        <div className="separator"></div>

        <Section label="Role Binding">
          <p className="rbac-edit-binding__input-label">Name:</p>
          {_.get(fixed, 'metadata.name')
            ? <ResourceName kind={kind} name={metadata.name} />
            : <input className="form-control" type="text" onChange={this.changeName} placeholder="Role binding name" value={metadata.name} />}
          {kind === 'RoleBinding' && <div>
            <div className="separator"></div>
            <p className="rbac-edit-binding__input-label">Namespace:</p>
            <NsDropdown fixedKey={_.get(fixed, 'metadata.namespace')} selectedKey={metadata.namespace} onChange={this.changeNamespace} />
          </div>}
        </Section>

        <div className="separator"></div>

        <Section label="Role">
          <p className="rbac-edit-binding__input-label">Role Name:</p>
          <RoleDropdown
            fixedKey={_.get(fixed, 'roleRef.name')}
            fixedKind={_.get(fixed, 'roleRef.kind')}
            onChange={this.changeRoleRef}
            selectedKey={roleRef.name}
          />
        </Section>

        <div className="separator"></div>

        <Section label="Subject">
          <RadioGroup currentValue={subject.kind} items={subjectKinds} onChange={this.changeSubjectKind} />
          {subject.kind === 'ServiceAccount' && <div>
            <div className="separator"></div>
            <p className="rbac-edit-binding__input-label">Subject Namespace:</p>
            <NsDropdown selectedKey={subject.namespace} onChange={this.changeSubjectNamespace} />
          </div>}
          <div className="separator"></div>
          <p className="rbac-edit-binding__input-label">Subject Name:</p>
          <input className="form-control" type="text" onChange={this.changeSubjectName} placeholder="Subject name" value={subject.name} />
        </Section>

        <div className="separator"></div>

        <ButtonBar errorMessage={this.state.error} inProgress={this.state.inProgress}>
          <button type="submit" className="btn btn-primary" onClick={this.save}>Create Binding</button>
          <Link to={getNamespacedRoute('rolebindings')}>Cancel</Link>
        </ButtonBar>
      </div>
    </div>;
  }
});

export const CreateRoleBinding = ({location: {query}}) => <BaseEditRoleBinding
  metadata={{
    namespace: getActiveNamespace(),
  }}
  fixed={{
    kind: (query.ns || query.rolekind === 'role') ? 'RoleBinding' : undefined,
    metadata: {namespace: query.ns},
    roleRef: {kind: k8sKind(query.rolekind), name: query.rolename},
  }}
  isCreate={true}
  title="Create Role Binding"
/>;

const EditBinding = props => {
  const {kind, metadata, roleRef} = props;
  return <BaseEditRoleBinding {...props} fixed={{kind, metadata, roleRef}} />;
};

export const EditRoleBinding = ({location, params, route}) => <Firehose kind={route.kind} name={params.name} namespace={params.ns}>
  <StatusBox>
    <EditBinding subjectIndex={location.query.subjectIndex} title="Edit Role Binding" />
  </StatusBox>
</Firehose>;

export const CopyRoleBinding = ({location, params, route}) => <Firehose kind={route.kind} name={params.name} namespace={params.ns}>
  <StatusBox>
    <BaseEditRoleBinding isCreate={true} subjectIndex={location.query.subjectIndex} title="Duplicate Role Binding" />
  </StatusBox>
</Firehose>;
