/*****************************************************************************/
/* Imports */
/*****************************************************************************/
var DynamicTemplate = Iron.DynamicTemplate;

/*****************************************************************************/
/* Helpers */
/*****************************************************************************/
/**
 * Find the first Layout in the rendered parent hierarchy.
 */
findFirstLayout = function (view) {
  while (view) {
    if (view.kind === 'Iron.Layout')
      return view.__dynamicTemplate__;
    else
      view = view.parentView;
  }

  return null;
};

/*****************************************************************************/
/* Layout */
/*****************************************************************************/

/**
 * Dynamically render templates into regions.
 *
 * Layout inherits from Iron.DynamicTemplate and provides the ability to create
 * regions that a user can render templates or content blocks into. The layout
 * and each region is an instance of DynamicTemplate so the template and data
 * contexts are completely dynamic and programmable in javascript.
 */
Layout = function (options) {
  var self = this;

  Layout.__super__.constructor.apply(this, arguments);

  options = options || {};
  this.kind = 'Iron.Layout';
  this._regions = {};
  this._hooks = {};
  this.defaultTemplate('__IronDefaultLayout__');

  // if there's block content then render that
  // to the main region
  if (options.content)
    this.render(options.content);
};

/**
 * The default region for a layout where the main content will go.
 */
DEFAULT_REGION = Layout.DEFAULT_REGION = 'main';

/**
 * Inherits from Iron.DynamicTemplate which gives us the ability to set the
 * template and data context dynamically.
 */
Meteor._inherits(Layout, Iron.DynamicTemplate);

/**
 * Return the DynamicTemplate instance for a given region. If the region doesn't
 * exist it is created.
 *
 * The regions object looks like this:
 *
 *  {
 *    "main": DynamicTemplate,
 *    "footer": DynamicTemplate,
 *    .
 *    .
 *    .
 *  }
 */
Layout.prototype.region = function (name, options) {
  return this._ensureRegion(name, options);
};

/**
 * Set the template for a region.
 */
Layout.prototype.render = function (template, options) {
  // having options is usually good
  options = options || {};

  // let the user specify the region to render the template into
  var region = options.to || options.region || DEFAULT_REGION;

  // get the DynamicTemplate for this region
  var dynamicTemplate = this.region(region);

  // if we're in a rendering transaction, track that we've rendered this
  // particular region
  this._trackRenderedRegion(region);

  // set the template value for the dynamic template
  dynamicTemplate.template(template);

  // if we have data go ahead and set the data for the dynamic template,
  // otherwise, leave it be.
  if (options.data)
    dynamicTemplate.data(options.data);
};

/**
 * Returns true if the given region is defined and false otherwise.
 */
Layout.prototype.has = function (region) {
  region = region || Layout.DEFAULT_REGION;
  return !!this._regions[region];
};

/**
 * Clear a given region or the "main" region by default.
 */
Layout.prototype.clear = function (region) {
  region = region || Layout.DEFAULT_REGION;

  // we don't want to create a region if it didn't exist before
  if (this.has(region))
    this.region(region).template(null);

  // chain it up
  return this;
};

/**
 * Clear all regions.
 */
Layout.prototype.clearAll = function () {
  _.each(this._regions, function (dynamicTemplate) {
    dynamicTemplate.template(null);
  });

  // chain it up
  return this;
};

/**
 * Start tracking rendered regions.
 */
Layout.prototype.beginRendering = function () {
  if (this._renderedRegions)
    throw new Error("You called beginRendering again before calling endRendering");
  this._renderedRegions = {};
};

/**
 * Track a rendered region if we're in a transaction.
 */
Layout.prototype._trackRenderedRegion = function (region) {
  if (!this._renderedRegions)
    return;
  this._renderedRegions[region] = true;
};

/**
 * Stop a rendering transaction and retrieve the rendered regions.
 */
Layout.prototype.endRendering = function () {
  // force all rendering to complete
  Deps.flush();

  var renderedRegions = this._renderedRegions;
  this._renderedRegions = null;
  return renderedRegions;
};

/**
 * Returns the DynamicTemplate for a given region or creates it if it doesn't
 * exists yet.
 */
Layout.prototype._ensureRegion = function (name, options) {
 return this._regions[name] = this._regions[name] || this._createDynamicTemplate(name, options);
};

/**
 * Create a new DynamicTemplate instance.
 */
Layout.prototype._createDynamicTemplate = function (name, options) {
  var self = this;
  var tmpl = new Iron.DynamicTemplate(options);
  return tmpl;
};

/*****************************************************************************/
/* UI Helpers */
/*****************************************************************************/

/**
 * Create a region in the closest layout ancestor.
 *
 * Examples:
 *    <aside>
 *      {{> yield "aside"}}
 *    </aside>
 *
 *    <article>
 *      {{> yield}}
 *    </article>
 *
 *    <footer>
 *      {{> yield "footer"}}
 *    </footer>
 */
UI.registerHelper('yield', Template.__create__('yield', function () {
  var layout = findFirstLayout(this);

  if (!layout)
    throw new Error("No Iron.Layout found so you can't use yield!");

  // Example options: {{> yield region="footer"}} or {{> yield "footer"}}
  var options = DynamicTemplate.getInclusionArguments(this);
  var region;

  if (_.isString(options)) {
    region = options;
  } else if (_.isObject(options)) {
    region = options.region;
  }

  // if there's no region specified we'll assume you meant the main region
  region = region || DEFAULT_REGION;

  // Add the region to the layout if it doesn't exist already and call the
  // create() method on the new DynamicTemplate to create the UI.Component and
  // return it. DynamicTemplate is not an instance of UI.Component.
  return layout.region(region).create();
}));

/**
 * Render a template into a region in the closest layout ancestor from within
 * your template markup.
 *
 * Examples:
 *
 *  {{#contentFor "footer"}}
 *    Footer stuff
 *  {{/contentFor}}
 *
 *  {{> contentFor region="footer" template="SomeTemplate" data=someData}}
 *
 * Note: The helper is a UI.Component object instead of a function so that
 * Meteor UI does not create a Deps.Dependency.
 */
UI.registerHelper('contentFor', Template.__create__('contentFor', function () {
  var layout = findFirstLayout(this);

  if (!layout)
    throw new Error("No Iron.Layout found so you can't use contentFor!");

  var options = DynamicTemplate.getInclusionArguments(this) || {}
  var content = this.templateContentBlock;
  var template = options.template;
  var data = options.data;

  if (_.isString(options))
    region = options;
  else if (_.isObject(options))
    region = options.region;
  else
    throw new Error("Which region is this contentFor block supposed to be for?");

  // set the region to a provided template or the content directly.
  layout.region(region).template(template || content);

  // tell the layout to track this as a rendered region if we're in a
  // rendering transaction.
  layout._trackRenderedRegion(region);

  // if we have some data then set the data context
  if (data)
    layout.region(region).data(data);

  // just render nothing into this area of the page since the dynamic template
  // will do the actual rendering into the right region.
  return null;
}));

/**
 * Let people use Layout directly from their templates!
 *
 * Example:
 *  {{#Layout template="MyTemplate"}}
 *    Main content goes here
 *
 *    {{#contentFor "footer"}}
 *      footer goes here
 *    {{/contentFor}}
 *  {{/Layout}}
 */
UI.registerHelper('Layout', Template.__create__('layout', function () {
  var args = Iron.DynamicTemplate.args(this);

  var layout = new Layout({
    template: function () { return args('template'); },
    data: function () { return args('data'); },
    content: this.templateContentBlock
  });

  return layout.create();
}));

/*****************************************************************************/
/* Namespacing */
/*****************************************************************************/
Iron.Layout = Layout;
