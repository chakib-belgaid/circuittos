//////////////////////////////////////////////////////////////////////////////
//
//  Circuit simulator
//
//////////////////////////////////////////////////////////////////////////////

// Copyright (C) 2011 Massachusetts Institute of Technology
// With modifications by Khan Academy.

// create a circuit for simulation using "new cktsim.Circuit()"

// for modified nodal analysis (MNA) stamps see
// http://www.analog-electronics.eu/analog-electronics/modified-nodal-analysis/modified-nodal-analysis.xhtml

var cktsim = (function () {
  ///////////////////////////////////////////////////////////////////////////////
  //
  //  Circuit
  //
  //////////////////////////////////////////////////////////////////////////////

  // types of "nodes" in the linear system
  var T_VOLTAGE = 0;
  var T_CURRENT = 1;

  var v_newt_lim = 0.3; // Voltage limited Newton great for Mos/diodes
  var v_abstol = 1e-6; // Absolute voltage error tolerance
  var i_abstol = 1e-12; // Absolute current error tolerance
  var eps = 1.0e-12; // A very small number compared to one.
  var dc_max_iters = 1000; // max iterations before giving up
  var max_tran_iters = 20; // max iterations before giving up
  var time_step_increase_factor = 2.0; // How much can lte let timestep grow.
  var lte_step_decrease_factor = 8; // Limit lte one-iter timestep shrink.
  var nr_step_decrease_factor = 4; // Newton failure timestep shrink.
  var reltol = 0.0001; // Relative tol to max observed value
  var lterel = 10; // LTE/Newton tolerance ratio (> 10!)
  var res_check_abs = Math.sqrt(i_abstol); // Loose Newton residue check
  var res_check_rel = Math.sqrt(reltol); // Loose Newton residue check

  function Circuit() {
    this.node_map = [];
    this.ntypes = [];
    this.initial_conditions = [];
    this.devices = [];
    this.device_map = [];
    this.voltage_sources = [];
    this.current_sources = [];
    this.finalized = false;
    this.diddc = false;
    this.node_index = -1;
    this.periods = 1
  }

  // index of ground node
  Circuit.prototype.gnd_node = function () {
    return -1;
  }

  // allocate a new node index
  Circuit.prototype.node = function (name, ntype, ic) {
    this.node_index += 1;
    if (name) this.node_map[name] = this.node_index;
    this.ntypes.push(ntype);
    this.initial_conditions.push(ic);
    return this.node_index;
  }

  // call to finalize the circuit in preparation for simulation
  Circuit.prototype.finalize = function () {
    if (!this.finalized) {
      this.finalized = true;
      this.N = this.node_index + 1;  // number of nodes

      // give each device a chance to finalize itself
      for (var i = this.devices.length - 1; i >= 0; --i)
        this.devices[i].finalize(this);

      // set up augmented matrix and various temp vectors
      this.matrix = mat_make(this.N, this.N + 1);
      this.Gl = mat_make(this.N, this.N);  // Matrix for linear conductances
      this.G = mat_make(this.N, this.N);  // Complete conductance matrix
      this.C = mat_make(this.N, this.N);  // Matrix for linear L's and C's

      this.soln_max = new Array(this.N);   // max abs value seen for each unknown
      this.abstol = new Array(this.N);
      this.solution = new Array(this.N);
      this.rhs = new Array(this.N);
      for (var i = this.N - 1; i >= 0; --i) {
        this.soln_max[i] = 0.0;
        this.abstol[i] = this.ntypes[i] == T_VOLTAGE ? v_abstol : i_abstol;
        this.solution[i] = 0.0;
        this.rhs[i] = 0.0;
      }

      // Load up the linear elements once and for all
      for (var i = this.devices.length - 1; i >= 0; --i) {
        this.devices[i].load_linear(this)
      }

      // Check for voltage source loops.
      var n_vsrc = this.voltage_sources.length;
      if (n_vsrc > 0) { // At least one voltage source
        var GV = mat_make(n_vsrc, this.N);  // Loop check
        for (var i = n_vsrc - 1; i >= 0; --i) {
          var branch = this.voltage_sources[i].branch;
          for (var j = this.N - 1; j >= 0; j--)
            GV[i][j] = this.Gl[branch][j];
        }
        var rGV = mat_rank(GV);
        if (rGV < n_vsrc) {
          //alert('Warning!!! Circuit has a voltage source loop or a source or current probe shorted by a wire, please remove the source or the wire causing the short.');
          //alert('Warning!!! Simulator might produce meaningless results or no result with illegal circuits.');
          alert(i18n.ckt_alert1);
          alert(i18n.ckt_alert2);
          return false;
        }
      }
    }
    return true;
  }

  // load circuit from JSON netlist (see schematic.js)
  Circuit.prototype.load_netlist = function (netlist) {
    // set up mapping for all ground connections
    for (var i = netlist.length - 1; i >= 0; --i) {
      var component = netlist[i];
      var type = component[0];
      if (type == 'g') {
        var connections = component[3];
        this.node_map[connections[0]] = this.gnd_node();
      }
    }

    // process each component in the JSON netlist (see schematic.js for format)
    var found_ground = false;
    for (var i = netlist.length - 1; i >= 0; --i) {
      var component = netlist[i];
      var type = component[0];

      // ignore wires, ground connections, scope probes and view info
      if (type == 'view' || type == 'w' || type == 'g' || type == 's' || type == 'L') {
        continue;
      }

      var properties = component[2];
      var name = properties['name'];
      if (name == undefined || name == '')
        name = '_' + properties['_json_'].toString();

      // convert node names to circuit indicies
      var connections = component[3];
      for (var j = connections.length - 1; j >= 0; --j) {
        var node = connections[j];
        var index = this.node_map[node];
        if (index == undefined) index = this.node(node, T_VOLTAGE);
        else if (index == this.gnd_node()) found_ground = true;
        connections[j] = index;
      }

      // process the component
      if (type == 'r')	// resistor
        this.r(connections[0], connections[1], properties['r'], name);
      else if (type == 'd')	// diode
        this.d(connections[0], connections[1], properties['area'], properties['type'], name);
      else if (type == 'c')   // capacitor
        this.c(connections[0], connections[1], properties['c'], name);
      else if (type == 'l')	// inductor
        this.l(connections[0], connections[1], properties['l'], name);
      else if (type == 'v') 	// voltage source
        this.v(connections[0], connections[1], properties['value'], name);
      else if (type == 'i') 	// current source
        this.i(connections[0], connections[1], properties['value'], name);
      else if (type == 'o') 	// op amp
        this.opamp(connections[0], connections[1], connections[2], connections[3], properties['A'], name);
      else if (type == 'n') 	// n fet
        this.n(connections[0], connections[1], connections[2], properties['WL'], name);
      else if (type == 'p') 	// p fet
        this.p(connections[0], connections[1], connections[2], properties['WL'], name);
      else if (type == 'a') 	// current probe == 0-volt voltage source
        this.v(connections[0], connections[1], '0', name);
    }

    if (!found_ground) { // No ground on schematic
      //alert('Please make at least one connection to ground (triangle symbol)');
      alert(i18n.ckt_alert3);

      /*	var content = document.createElement('div');
             var strAlert = document.createTextNode(i18n.ckt_alert3);
             content.appendChild(strAlert);
             this.dialog(i18n.Alert,content);

             return false;	*/
    }
    return true;
  }

  // if converges: updates this.solution, this.soln_max, returns iter count
  // otherwise: return undefined and set this.problem_node
  // Load should compute -f and df/dx (note the sign pattern!)
  Circuit.prototype.find_solution = function (load, maxiters) {
    var soln = this.solution;
    var rhs = this.rhs;
    var d_sol = [];
    var abssum_compare;
    var converged, abssum_old = 0, abssum_rhs;
    var use_limiting = false;
    var down_count = 0;
    var thresh;

    // iteratively solve until values convere or iteration limit exceeded
    for (var iter = 0; iter < maxiters; iter++) {
      // set up equations
      load(this, soln, rhs);

      // Compute norm of rhs, assume variables of v type go with eqns of i type
      abssum_rhs = 0;
      for (var i = this.N - 1; i >= 0; --i)
        if (this.ntypes[i] == T_VOLTAGE)
          abssum_rhs += Math.abs(rhs[i]);

      if ((iter > 0) && (use_limiting == false) && (abssum_old < abssum_rhs)) {
        // Old rhsnorm was better, undo last iter and turn on limiting
        for (var i = this.N - 1; i >= 0; --i)
          soln[i] -= d_sol[i];
        iter -= 1;
        use_limiting = true;
      }
      else {  // Compute the Newton delta
        d_sol = mat_solve_rq(this.matrix, rhs);

        // If norm going down for ten iters, stop limiting
        if (abssum_rhs < abssum_old)
          down_count += 1;
        else
          down_count = 0;
        if (down_count > 10) {
          use_limiting = false;
          down_count = 0;
        }

        // Update norm of rhs
        abssum_old = abssum_rhs;
      }

      // Update the worst case abssum for comparison.
      if ((iter == 0) || (abssum_rhs > abssum_compare))
        abssum_compare = abssum_rhs;

      // Check residue convergence, but loosely, and give up
      // on last iteration
      if ((iter < (maxiters - 1)) &&
        (abssum_rhs > (res_check_abs + res_check_rel * abssum_compare)))
        converged = false;
      else converged = true;


      // Update solution and check delta convergence
      for (var i = this.N - 1; i >= 0; --i) {
        // Simple voltage step limiting to encourage Newton convergence
        if (use_limiting) {
          if (this.ntypes[i] == T_VOLTAGE) {
            d_sol[i] = (d_sol[i] > v_newt_lim) ? v_newt_lim : d_sol[i];
            d_sol[i] = (d_sol[i] < -v_newt_lim) ? -v_newt_lim : d_sol[i];
          }
        }
        soln[i] += d_sol[i];
        thresh = this.abstol[i] + reltol * this.soln_max[i];
        if (Math.abs(d_sol[i]) > thresh) {
          converged = false;
          this.problem_node = i;
        }
      }

      if (converged == true) {
        for (var i = this.N - 1; i >= 0; --i)
          if (Math.abs(soln[i]) > this.soln_max[i])
            this.soln_max[i] = Math.abs(soln[i]);
        return iter + 1;
      }
    }
    return undefined;
  }

  // DC analysis
  Circuit.prototype.dc = function () {
    // Allocation matrices for linear part, etc.
    if (this.finalize() == false)
      return undefined;

    // Define -f and df/dx for Newton solver
    function load_dc(ckt, soln, rhs) {
      // rhs is initialized to -Gl * soln
      mat_v_mult(ckt.Gl, soln, rhs, -1.0);
      // G matrix is initialized with linear Gl
      mat_copy(ckt.Gl, ckt.G);
      // Now load up the nonlinear parts of rhs and G
      for (var i = ckt.devices.length - 1; i >= 0; --i)
        ckt.devices[i].load_dc(ckt, soln, rhs);
      // G matrix is copied in to the system matrix
      mat_copy(ckt.G, ckt.matrix);
    }

    // find the operating point
    var iterations = this.find_solution(load_dc, dc_max_iters);
    if (typeof iterations == 'undefined') {
      // too many iterations
      if (this.current_sources.length > 0) {
        //alert('Newton Method Failed, do your current sources have a conductive path to ground?');
        alert(i18n.ckt_alert4);
      } else {
        //alert('Newton Method Failed, it may be your circuit or it may be our simulator.');
        alert(i18n.ckt_alert5);
      }

      return undefined
    } else {
      // Note that a dc solution was computed
      this.diddc = true;
      // create solution dictionary
      var result = [];
      // capture node voltages
      for (var name in this.node_map) {
        var index = this.node_map[name];
        result[name] = (index == -1) ? 0 : this.solution[index];
      }
      // capture branch currents from voltage sources
      for (var i = this.voltage_sources.length - 1; i >= 0; --i) {
        var v = this.voltage_sources[i];
        result['I(' + v.name + ')'] = this.solution[v.branch];
      }
      return result;
    }
  }

  // Transient analysis (needs work!)
  Circuit.prototype.tran = function (ntpts, tstart, tstop, probenames, no_dc) {

    // Define -f and df/dx for Newton solver
    function load_tran(ckt, soln, rhs) {
      // Crnt is initialized to -Gl * soln
      mat_v_mult(ckt.Gl, soln, ckt.c, -1.0);
      // G matrix is initialized with linear Gl
      mat_copy(ckt.Gl, ckt.G);
      // Now load up the nonlinear parts of crnt and G
      for (var i = ckt.devices.length - 1; i >= 0; --i)
        ckt.devices[i].load_tran(ckt, soln, ckt.c, ckt.time);
      // Exploit the fact that storage elements are linear
      mat_v_mult(ckt.C, soln, ckt.q, 1.0);
      // -rhs = c - dqdt
      for (var i = ckt.N - 1; i >= 0; --i) {
        var dqdt = ckt.alpha0 * ckt.q[i] + ckt.alpha1 * ckt.oldq[i] +
          ckt.alpha2 * ckt.old2q[i];
        rhs[i] = ckt.beta0[i] * ckt.c[i] + ckt.beta1[i] * ckt.oldc[i] - dqdt;
      }
      // matrix = beta0*G + alpha0*C.
      mat_scale_add(ckt.G, ckt.C, ckt.beta0, ckt.alpha0, ckt.matrix);
    }

    var p = new Array(3);

    function interp_coeffs(t, t0, t1, t2) {
      // Poly coefficients
      var dtt0 = (t - t0);
      var dtt1 = (t - t1);
      var dtt2 = (t - t2);
      var dt0dt1 = (t0 - t1);
      var dt0dt2 = (t0 - t2);
      var dt1dt2 = (t1 - t2);
      p[0] = (dtt1 * dtt2) / (dt0dt1 * dt0dt2);
      p[1] = (dtt0 * dtt2) / (-dt0dt1 * dt1dt2);
      p[2] = (dtt0 * dtt1) / (dt0dt2 * dt1dt2);
      return p;
    }

    function pick_step(ckt, step_index) {
      var min_shrink_factor = 1.0 / lte_step_decrease_factor;
      var max_growth_factor = time_step_increase_factor;
      var N = ckt.N;
      var p = interp_coeffs(ckt.time, ckt.oldt, ckt.old2t, ckt.old3t);
      var trapcoeff = 0.5 * (ckt.time - ckt.oldt) / (ckt.time - ckt.old3t);
      var maxlteratio = 0.0;
      for (var i = ckt.N - 1; i >= 0; --i) {
        if (ckt.ltecheck[i]) { // Check lte on variable
          var pred = p[0] * ckt.oldsol[i] + p[1] * ckt.old2sol[i] + p[2] * ckt.old3sol[i];
          var lte = Math.abs((ckt.solution[i] - pred)) * trapcoeff;
          var lteratio = lte / (lterel * (ckt.abstol[i] + reltol * ckt.soln_max[i]));
          maxlteratio = Math.max(maxlteratio, lteratio);
        }
      }
      var new_step;
      var lte_step_ratio = 1.0 / Math.pow(maxlteratio, 1 / 3); // Cube root because trap
      if (lte_step_ratio < 1.0) { // Shrink the timestep to make lte
        lte_step_ratio = Math.max(lte_step_ratio, min_shrink_factor);
        new_step = (ckt.time - ckt.oldt) * 0.75 * lte_step_ratio;
        new_step = Math.max(new_step, ckt.min_step);
      } else {
        lte_step_ratio = Math.min(lte_step_ratio, max_growth_factor);
        if (lte_step_ratio > 1.2)  /* Increase timestep due to lte. */
          new_step = (ckt.time - ckt.oldt) * lte_step_ratio / 1.2;
        else
          new_step = (ckt.time - ckt.oldt);
        new_step = Math.min(new_step, ckt.max_step);
      }
      return new_step;
    }

    // Standard to do a dc analysis before transient
    // Otherwise, do the setup also done in dc.
    no_dc = false;
    if ((this.diddc == false) && (no_dc == false)) {
      if (this.dc() == undefined) { // DC failed, realloc mats and vects.
        //alert('DC failed, trying transient analysis from zero.');
        alert(i18n.ckt_alert6);
        this.finalized = false;  // Reset the finalization.
        if (this.finalize() == false)
          return undefined;
      }
    }
    else {
      if (this.finalize() == false) // Allocate matrices and vectors.
        return undefined;
    }

    // Tired of typing this, and using "with" generates hate mail.
    var N = this.N;

    // build array to hold list of results for each variable
    // last entry is for timepoints.
    var response = new Array(N + 1);
    for (var i = N; i >= 0; --i) response[i] = [];

    // Allocate back vectors for up to a second order method
    this.old3sol = new Array(this.N);
    this.old3q = new Array(this.N);
    this.old2sol = new Array(this.N);
    this.old2q = new Array(this.N);
    this.oldsol = new Array(this.N);
    this.oldq = new Array(this.N);
    this.q = new Array(this.N);
    this.oldc = new Array(this.N);
    this.c = new Array(this.N);
    this.alpha0 = 1.0;
    this.alpha1 = 0.0;
    this.alpha2 = 0.0;
    this.beta0 = new Array(this.N);
    this.beta1 = new Array(this.N);

    // Mark a set of algebraic variable (don't miss hidden ones!).
    this.ar = this.algebraic(this.C);

    // Non-algebraic variables and probe variables get lte
    this.ltecheck = new Array(this.N);
    for (var i = N; i >= 0; --i)
      this.ltecheck[i] = (this.ar[i] == 0);

    for (var name in this.node_map) {
      var index = this.node_map[name];
      for (var i = probenames.length; i >= 0; --i) {
        if (name == probenames[i]) {
          this.ltecheck[index] = true;
          break;
        }
      }
    }

    // Check for periodic sources
    var period = tstop - tstart;
    for (var i = this.voltage_sources.length - 1; i >= 0; --i) {
      var per = this.voltage_sources[i].src.period;
      if (per > 0)
        period = Math.min(period, per);
    }
    for (var i = this.current_sources.length - 1; i >= 0; --i) {
      var per = this.current_sources[i].src.period;
      if (per > 0)
        period = Math.min(period, per);
    }
    this.periods = Math.ceil((tstop - tstart) / period);

    this.time = tstart;
    // ntpts adjusted by numbers of periods in input
    this.max_step = (tstop - tstart) / (this.periods * ntpts);
    this.min_step = this.max_step / 1e8;
    var new_step = this.max_step / 1e6;
    this.oldt = this.time - new_step;

    // Initialize old crnts, charges, and solutions.
    load_tran(this, this.solution, this.rhs)
    for (var i = N - 1; i >= 0; --i) {
      this.old3sol[i] = this.solution[i];
      this.old2sol[i] = this.solution[i];
      this.oldsol[i] = this.solution[i];
      this.old3q[i] = this.q[i];
      this.old2q[i] = this.q[i];
      this.oldq[i] = this.q[i];
      this.oldc[i] = this.c[i];
    }

    var beta0, beta1;
    // Start with two pseudo-Euler steps, maximum 50000 steps/period
    var max_nsteps = this.periods * 50000;
    for (var step_index = -3; step_index < max_nsteps; step_index++) {
      // Save the just computed solution, and move back q and c.
      for (var i = this.N - 1; i >= 0; --i) {
        if (step_index >= 0)
          response[i].push(this.solution[i]);
        this.oldc[i] = this.c[i];
        this.old3sol[i] = this.old2sol[i];
        this.old2sol[i] = this.oldsol[i];
        this.oldsol[i] = this.solution[i];
        this.old3q[i] = this.oldq[i];
        this.old2q[i] = this.oldq[i];
        this.oldq[i] = this.q[i];
      }

      if (step_index < 0) {  // Take a prestep using BE
        this.old3t = this.old2t - (this.oldt - this.old2t)
        this.old2t = this.oldt - (tstart - this.oldt)
        this.oldt = tstart - (this.time - this.oldt);
        this.time = tstart;
        beta0 = 1.0;
        beta1 = 0.0;
      } else {  // Take a regular step
        // Save the time, and rotate time wheel
        response[this.N].push(this.time);
        this.old3t = this.old2t;
        this.old2t = this.oldt;
        this.oldt = this.time;
        // Make sure we come smoothly in to the interval end.
        if (this.time >= tstop) break;  // We're done.
        else if (this.time + new_step > tstop)
          this.time = tstop;
        else if (this.time + 1.5 * new_step > tstop)
          this.time += (2 / 3) * (tstop - this.time);
        else
          this.time += new_step;

        // Use trap (average old and new crnts.
        beta0 = 0.5;
        beta1 = 0.5;
      }

      // For trap rule, turn off current avging for algebraic eqns
      for (var i = this.N - 1; i >= 0; --i) {
        this.beta0[i] = beta0 + this.ar[i] * beta1;
        this.beta1[i] = (1.0 - this.ar[i]) * beta1;
      }

      // Loop to find NR converging timestep with okay LTE
      while (true) {
        // Set the timestep coefficients (alpha2 is for bdf2).
        this.alpha0 = 1.0 / (this.time - this.oldt);
        this.alpha1 = -this.alpha0;
        this.alpha2 = 0;

        // If timestep is 1/10,000th of tstop, just use BE.
        if ((this.time - this.oldt) < 1.0e-4 * tstop) {
          for (var i = this.N - 1; i >= 0; --i) {
            this.beta0[i] = 1.0;
            this.beta1[i] = 0.0;
          }
        }
        // Use Newton to compute the solution.
        var iterations = this.find_solution(load_tran, max_tran_iters);

        // If NR succeeds and stepsize is at min, accept and newstep=maxgrowth*minstep.
        // Else if Newton Fails, shrink step by a factor and try again
        // Else LTE picks new step, if bigger accept current step and go on.
        if ((iterations != undefined) &&
          (step_index <= 0 || (this.time - this.oldt) < (1 + reltol) * this.min_step)) {
          if (step_index > 0) new_step = time_step_increase_factor * this.min_step;
          break;
        } else if (iterations == undefined) {  // NR nonconvergence, shrink by factor
          this.time = this.oldt +
            (this.time - this.oldt) / nr_step_decrease_factor;
        } else {  // Check the LTE and shrink step if needed.
          new_step = pick_step(this, step_index);
          if (new_step < (1.0 - reltol) * (this.time - this.oldt)) {
            this.time = this.oldt + new_step;  // Try again
          }
          else
            break;  // LTE okay, new_step for next step
        }
      }
    }

    // create solution dictionary
    var result = [];
    for (var name in this.node_map) {
      var index = this.node_map[name];
      result[name] = (index == -1) ? 0 : response[index];
    }
    // capture branch currents from voltage sources
    for (var i = this.voltage_sources.length - 1; i >= 0; --i) {
      var v = this.voltage_sources[i];
      result['I(' + v.name + ')'] = response[v.branch];
    }

    result['_time_'] = response[this.N];
    return result;
  }

  // AC analysis: npts/decade for freqs in range [fstart,fstop]
  // result['_frequencies_'] = vector of log10(sample freqs)
  // result['xxx'] = vector of dB(response for node xxx)
  // NOTE: Normalization removed in schematic.js, jkw.
  Circuit.prototype.ac = function (npts, fstart, fstop, source_name) {

    if (this.dc() == undefined) { // DC failed, realloc mats and vects.
      return undefined;
    }

    var N = this.N;
    var G = this.G;
    var C = this.C;

    // Complex numbers, we're going to need a bigger boat
    var matrixac = mat_make(2 * N, (2 * N) + 1);

    // Get the source used for ac
    if (this.device_map[source_name] === undefined) {
      //alert('AC analysis refers to unknown source ' + source_name);
      //return 'AC analysis failed, unknown source';
      alert(i18n.ckt_alert7 + source_name);
      return i18n.ckt_alert8;
    }
    this.device_map[source_name].load_ac(this, this.rhs);

    // build array to hold list of magnitude and phases for each node
    // last entry is for frequency values
    var response = new Array(2 * N + 1);
    for (var i = 2 * N; i >= 0; --i) response[i] = [];

    // multiplicative frequency increase between freq points
    var delta_f = Math.exp(Math.LN10 / npts);

    var phase_offset = new Array(N);
    for (var i = N - 1; i >= 0; --i) phase_offset[i] = 0;

    var xf = fstart;
    fstop *= 1.0001;  // capture that last freq point!
    while (xf <= fstop) {
      var omega = 2 * Math.PI * xf;
      response[2 * N].push(xf);   // 2*N for magnitude and phase

      // Find complex x+jy that sats Gx-omega*Cy=rhs; omega*Cx+Gy=0
      // Note: solac[0:N-1]=x, solac[N:2N-1]=y
      for (var i = N - 1; i >= 0; --i) {
        // First the rhs, replicated for real and imaginary
        matrixac[i][2 * N] = this.rhs[i];
        matrixac[i + N][2 * N] = 0;

        for (var j = N - 1; j >= 0; --j) {
          matrixac[i][j] = G[i][j];
          matrixac[i + N][j + N] = G[i][j];
          matrixac[i][j + N] = -omega * C[i][j];
          matrixac[i + N][j] = omega * C[i][j];
        }
      }

      // Compute the small signal response
      var solac = mat_solve(matrixac);

      // Save magnitude and phase
      for (var i = N - 1; i >= 0; --i) {
        var mag = Math.sqrt(solac[i] * solac[i] + solac[i + N] * solac[i + N]);
        response[i].push(mag);

        // Avoid wrapping phase, add or sub 180 for each jump
        var phase = 180 * (Math.atan2(solac[i + N], solac[i]) / Math.PI);
        var phasei = response[i + N];
        var L = phasei.length;
        // Look for a one-step jump greater than 90 degrees
        if (L > 1) {
          var phase_jump = phase + phase_offset[i] - phasei[L - 1];
          if (phase_jump > 90) {
            phase_offset[i] -= 360;
          } else if (phase_jump < -90) {
            phase_offset[i] += 360;
          }
        }
        response[i + N].push(phase + phase_offset[i]);
      }
      xf *= delta_f;    // increment frequency
    }

    // create solution dictionary
    var result = [];
    for (var name in this.node_map) {
      var index = this.node_map[name];
      result[name] = (index == -1) ? 0 : response[index];
      result[name + '_phase'] = (index == -1) ? 0 : response[index + N];
    }
    result['_frequencies_'] = response[2 * N];
    return result;
  }

  // Helper for adding devices to a circuit, warns on duplicate device names.
  Circuit.prototype.add_device = function (d, name) {
    // Add device to list of devices and to device map
    this.devices.push(d);
    d.name = name;
    if (name) {
      if (this.device_map[name] === undefined)
        this.device_map[name] = d;
      else {
        //alert('Warning: two circuit elements share the same name ' + name);
        alert(i18n.ckt_warning1 + name);
        this.device_map[name] = d;
      }
    }
    return d;
  }

  Circuit.prototype.r = function (n1, n2, v, name) {
    // try to convert string value into numeric value, barf if we can't
    if ((typeof v) == 'string') {
      v = parse_number(v, undefined);
      if (v === undefined) return undefined;
    }

    if (v != 0) {
      var d = new Resistor(n1, n2, v);
      return this.add_device(d, name);
    } else return this.v(n1, n2, '0', name);   // zero resistance == 0V voltage source
  }

  Circuit.prototype.d = function (n1, n2, area, type, name) {
    // try to convert string value into numeric value, barf if we can't
    if ((typeof area) == 'string') {
      area = parse_number(area, undefined);
      if (area === undefined) return undefined;
    }

    if (area != 0) {
      var d = new Diode(n1, n2, area, type);
      return this.add_device(d, name);
    } // zero area diodes discarded.
  }

  Circuit.prototype.c = function (n1, n2, v, name) {
    // try to convert string value into numeric value, barf if we can't
    if ((typeof v) == 'string') {
      v = parse_number(v, undefined);
      if (v === undefined) return undefined;
    }
    var d = new Capacitor(n1, n2, v);
    return this.add_device(d, name);
  }

  Circuit.prototype.l = function (n1, n2, v, name) {
    // try to convert string value into numeric value, barf if we can't
    if ((typeof v) == 'string') {
      v = parse_number(v, undefined);
      if (v === undefined) return undefined;
    }
    var branch = this.node(undefined, T_CURRENT);
    var d = new Inductor(n1, n2, branch, v);
    return this.add_device(d, name);
  }

  Circuit.prototype.v = function (n1, n2, v, name) {
    var branch = this.node(undefined, T_CURRENT);
    var d = new VSource(n1, n2, branch, v);
    this.voltage_sources.push(d);
    return this.add_device(d, name);
  }

  Circuit.prototype.i = function (n1, n2, v, name) {
    var d = new ISource(n1, n2, v);
    this.current_sources.push(d);
    return this.add_device(d, name);
  }

  Circuit.prototype.opamp = function (np, nn, no, ng, A, name) {
    var ratio;
    // try to convert string value into numeric value, barf if we can't
    if ((typeof A) == 'string') {
      ratio = parse_number(A, undefined);
      if (A === undefined) return undefined;
    }
    var branch = this.node(undefined, T_CURRENT);
    var d = new Opamp(np, nn, no, ng, branch, A, name);
    return this.add_device(d, name);
  }

  Circuit.prototype.n = function (d, g, s, ratio, name) {
    // try to convert string value into numeric value, barf if we can't
    if ((typeof ratio) == 'string') {
      ratio = parse_number(ratio, undefined);
      if (ratio === undefined) return undefined;
    }
    var d = new Fet(d, g, s, ratio, name, 'n');
    return this.add_device(d, name);
  }

  Circuit.prototype.p = function (d, g, s, ratio, name) {
    // try to convert string value into numeric value, barf if we can't
    if ((typeof ratio) == 'string') {
      ratio = parse_number(ratio, undefined);
      if (ratio === undefined) return undefined;
    }
    var d = new Fet(d, g, s, ratio, name, 'p');
    return this.add_device(d, name);
  }

  ///////////////////////////////////////////////////////////////////////////////
  //
  //  Support for creating conductance and capacitance matrices associated with
  //  modified nodal analysis (unknowns are node voltages and inductor and voltage
  //  source currents).
  //  The linearized circuit is written as
  //          C d/dt x = G x + rhs
  //  x - vector of node voltages and element currents
  //  rhs - vector of source values
  //  C - Matrix whose values are capacitances and inductances, has many zero rows.
  //  G - Matrix whose values are conductances and +-1's.
  //
  ////////////////////////////////////////////////////////////////////////////////

  // add val component between two nodes to matrix M
  // Index of -1 refers to ground node
  Circuit.prototype.add_two_terminal = function (i, j, g, M) {
    if (i >= 0) {
      M[i][i] += g;
      if (j >= 0) {
        M[i][j] -= g;
        M[j][i] -= g;
        M[j][j] += g;
      }
    } else if (j >= 0)
      M[j][j] += g;
  }

  // add val component between two nodes to matrix M
  // Index of -1 refers to ground node
  Circuit.prototype.get_two_terminal = function (i, j, x) {
    var xi_minus_xj = 0;
    if (i >= 0) xi_minus_xj = x[i];
    if (j >= 0) xi_minus_xj -= x[j];
    return xi_minus_xj
  }

  Circuit.prototype.add_conductance_l = function (i, j, g) {
    this.add_two_terminal(i, j, g, this.Gl)
  }

  Circuit.prototype.add_conductance = function (i, j, g) {
    this.add_two_terminal(i, j, g, this.G)
  }

  Circuit.prototype.add_capacitance = function (i, j, c) {
    this.add_two_terminal(i, j, c, this.C)
  }

  // add individual conductance to Gl matrix
  Circuit.prototype.add_to_Gl = function (i, j, g) {
    if (i >= 0 && j >= 0)
      this.Gl[i][j] += g;
  }

  // add individual conductance to Gl matrix
  Circuit.prototype.add_to_G = function (i, j, g) {
    if (i >= 0 && j >= 0)
      this.G[i][j] += g;
  }

  // add individual capacitance to C matrix
  Circuit.prototype.add_to_C = function (i, j, c) {
    if (i >= 0 && j >= 0)
      this.C[i][j] += c;
  }

  // add source info to rhs
  Circuit.prototype.add_to_rhs = function (i, v, rhs) {
    if (i >= 0) rhs[i] += v;
  }


  ///////////////////////////////////////////////////////////////////////////////
  //
  //  Generic matrix support - making, copying, factoring, rank, etc
  //  Note, Matrices are stored using nested javascript arrays.
  ////////////////////////////////////////////////////////////////////////////////

  // Allocate an NxM matrix
  function mat_make(N, M) {
    var mat = new Array(N);
    for (var i = N - 1; i >= 0; --i) {
      mat[i] = new Array(M);
      for (var j = M - 1; j >= 0; --j) {
        mat[i][j] = 0.0;
      }
    }
    return mat;
  }

  // Form b = scale*Mx
  function mat_v_mult(M, x, b, scale) {
    var n = M.length;
    var m = M[0].length;

    if (n != b.length || m != x.length)
    //throw 'Rows of M mismatched to b or cols mismatch to x.';
      throw i18n.ckt_error1;

    for (var i = 0; i < n; i++) {
      var temp = 0;
      for (var j = 0; j < m; j++) temp += M[i][j] * x[j];
      b[i] = scale * temp;  // Recall the neg in the name
    }
  }

  // C = scalea*A + scaleb*B, scalea, scaleb eithers numbers or arrays (row scaling)
  function mat_scale_add(A, B, scalea, scaleb, C) {
    var n = A.length;
    var m = A[0].length;

    if (n > B.length || m > B[0].length)
    //throw 'Row or columns of A to large for B';
      throw i18n.ckt_error2;
    if (n > C.length || m > C[0].length)
    //throw 'Row or columns of A to large for C';
      throw i18n.ckt_error3;
    if ((typeof scalea == 'number') && (typeof scaleb == 'number'))
      for (var i = 0; i < n; i++)
        for (var j = 0; j < m; j++)
          C[i][j] = scalea * A[i][j] + scaleb * B[i][j];
    else if ((typeof scaleb == 'number') && (scalea instanceof Array))
      for (var i = 0; i < n; i++)
        for (var j = 0; j < m; j++)
          C[i][j] = scalea[i] * A[i][j] + scaleb * B[i][j];
    else if ((typeof scaleb instanceof Array) && (scalea instanceof Array))
      for (var i = 0; i < n; i++)
        for (var j = 0; j < m; j++)
          C[i][j] = scalea[i] * A[i][j] + scaleb[i] * B[i][j];
    else
    //throw 'scalea and scaleb must be scalars or Arrays';
      throw i18n.ckt_error4;
  }

  // Returns a vector of ones and zeros, ones denote algebraic
  // variables (rows that can be removed without changing rank(M).
  Circuit.prototype.algebraic = function (M) {
    var Nr = M.length
    var Mc = mat_make(Nr, Nr);
    mat_copy(M, Mc);
    var R = mat_rank(Mc);

    var one_if_alg = new Array(Nr);
    for (var row = 0; row < Nr; row++) {  // psuedo gnd row small
      for (var col = Nr - 1; col >= 0; --col)
        Mc[row][col] = 0;
      if (mat_rank(Mc) == R)  // Zeroing row left rank unchanged
        one_if_alg[row] = 1;
      else { // Zeroing row changed rank, put back
        for (var col = Nr - 1; col >= 0; --col)
          Mc[row][col] = M[row][col];
        one_if_alg[row] = 0;
      }
    }
    return one_if_alg;
  }

  // Copy A -> using the bounds of A
  function mat_copy(src, dest) {
    var n = src.length;
    var m = src[0].length;
    if (n > dest.length || m > dest[0].length)
    //throw 'Rows or cols > rows or cols of dest';
      throw i18n.ckt_error5;

    for (var i = 0; i < n; i++)
      for (var j = 0; j < m; j++)
        dest[i][j] = src[i][j];
  }

  // Copy and transpose A -> using the bounds of A
  function mat_copy_transposed(src, dest) {
    var n = src.length;
    var m = src[0].length;
    if (n > dest[0].length || m > dest.length)
    //throw 'Rows or cols > cols or rows of dest';
      throw i18n.ckt_error6;

    for (var i = 0; i < n; i++)
      for (var j = 0; j < m; j++)
        dest[j][i] = src[i][j];
  }


  // Uses GE to determine rank.
  function mat_rank(Mo) {
    var Nr = Mo.length;  // Number of rows
    var Nc = Mo[0].length;  // Number of columns
    var temp, i, j;
    // Make a copy to avoid overwriting
    var M = mat_make(Nr, Nc);
    mat_copy(Mo, M);

    // Find matrix maximum entry
    var max_abs_entry = 0;
    for (var row = Nr - 1; row >= 0; --row) {
      for (var col = Nr - 1; col >= 0; --col) {
        if (Math.abs(M[row][col]) > max_abs_entry)
          max_abs_entry = Math.abs(M[row][col]);
      }
    }

    // Gaussian elimination to find rank
    var the_rank = 0;
    var start_col = 0;
    for (var row = 0; row < Nr; row++) {
      // Search for first nonzero column in the remaining rows.
      for (var col = start_col; col < Nc; col++) {
        var max_v = Math.abs(M[row][col]);
        var max_row = row;
        for (var i = row + 1; i < Nr; i++) {
          temp = Math.abs(M[i][col]);
          if (temp > max_v) {
            max_v = temp;
            max_row = i;
          }
        }
        // if max_v non_zero, column is nonzero, eliminate in subsequent rows
        if (Math.abs(max_v) > eps * max_abs_entry) {
          start_col = col + 1;
          the_rank += 1;
          // Swap rows to get max in M[row][col]
          temp = M[row];
          M[row] = M[max_row];
          M[max_row] = temp;

          // now eliminate this column for all subsequent rows
          for (var i = row + 1; i < Nr; i++) {
            temp = M[i][col] / M[row][col];   // multiplier for current row
            if (temp != 0)  // subtract
              for (var j = col; j < Nc; j++) M[i][j] -= M[row][j] * temp;
          }
          // Now move on to the next row
          break;
        }
      }
    }

    return the_rank;
  }

  // Solve Mx=b and return vector x using R^TQ^T factorization.
  // Multiplication by R^T implicit, should be null-space free soln.
  // M should have the extra column!
  // Almost everything is in-lined for speed, sigh.
  function mat_solve_rq(M, rhs) {
    var scale;
    var Nr = M.length;  // Number of rows
    var Nc = M[0].length;  // Number of columns

    // Copy the rhs in to the last column of M if one is given.
    if (rhs != null) {
      for (var row = Nr - 1; row >= 0; --row)
        M[row][Nc - 1] = rhs[row];
    }

    var mat_scale = 0; // Sets the scale for comparison to zero.
    var max_nonzero_row = Nr - 1;  // Assumes M nonsingular.
    for (var row = 0; row < Nr; row++) {
      // Find largest row with largest 2-norm
      var max_row = row;
      var maxsumsq = 0;
      for (var rowp = row; rowp < Nr; rowp++) {
        var Mr = M[rowp];
        var sumsq = 0;
        for (var col = Nc - 2; col >= 0; --col)  // Last col=rhs
          sumsq += Mr[col] * Mr[col];
        if ((row == rowp) || (sumsq > maxsumsq)) {
          max_row = rowp;
          maxsumsq = sumsq;
        }
      }
      if (max_row > row) { // Swap rows if not max row
        var temp = M[row];
        M[row] = M[max_row];
        M[max_row] = temp;
      }

      // Calculate row norm, save if this is first (largest)
      var row_norm = Math.sqrt(maxsumsq);
      if (row == 0) mat_scale = row_norm;

      // Check for all zero rows
      if (row_norm > mat_scale * eps)
        scale = 1.0 / row_norm;
      else {
        max_nonzero_row = row - 1;  // Rest will be nullspace of M
        break;
      }

      // Nonzero row, eliminate from rows below
      var Mr = M[row];
      for (var col = Nc - 1; col >= 0; --col) // Scale rhs also
        Mr[col] *= scale;
      for (var rowp = row + 1; rowp < Nr; rowp++) { // Update.
        var Mrp = M[rowp];
        var inner = 0;
        for (var col = Nc - 2; col >= 0; --col)  // Project
          inner += Mr[col] * Mrp[col];
        for (var col = Nc - 1; col >= 0; --col) // Ortho (rhs also)
          Mrp[col] -= inner * Mr[col];
      }
    }

    // Last Column of M has inv(R^T)*rhs.  Scale rows of Q to get x.
    var x = new Array(Nc - 1);
    for (var col = Nc - 2; col >= 0; --col)
      x[col] = 0;
    for (var row = max_nonzero_row; row >= 0; --row) {
      Mr = M[row];
      for (var col = Nc - 2; col >= 0; --col) {
        x[col] += Mr[col] * Mr[Nc - 1];
      }
    }

    return x;
  }

  // solve Mx=b and return vector x given augmented matrix M = [A | b]
  // Uses Gaussian elimination with partial pivoting
  function mat_solve(M, rhs) {
    var N = M.length;      // augmented matrix M has N rows, N+1 columns
    var temp, i, j;

    // Copy the rhs in to the last column of M if one is given.
    if (rhs != null) {
      for (var row = 0; row < N; row++)
        M[row][N] = rhs[row];
    }

    // gaussian elimination
    for (var col = 0; col < N; col++) {
      // find pivot: largest abs(v) in this column of remaining rows
      var max_v = Math.abs(M[col][col]);
      var max_col = col;
      for (i = col + 1; i < N; i++) {
        temp = Math.abs(M[i][col]);
        if (temp > max_v) {
          max_v = temp;
          max_col = i;
        }
      }

      // if no value found, generate a small conductance to gnd
      // otherwise swap current row with pivot row
      if (max_v == 0) M[col][col] = eps;
      else {
        temp = M[col];
        M[col] = M[max_col];
        M[max_col] = temp;
      }

      // now eliminate this column for all subsequent rows
      for (i = col + 1; i < N; i++) {
        temp = M[i][col] / M[col][col];   // multiplier we'll use for current row
        if (temp != 0)
        // subtract current row from row we're working on
        // remember to process b too!
          for (j = col; j <= N; j++) M[i][j] -= M[col][j] * temp;
      }
    }

    // matrix is now upper triangular, so solve for elements of x starting
    // with the last row
    var x = new Array(N);
    for (i = N - 1; i >= 0; --i) {
      temp = M[i][N];   // grab b[i] from augmented matrix as RHS
      // subtract LHS term from RHS using known x values
      for (j = N - 1; j > i; --j) temp -= M[i][j] * x[j];
      // now compute new x value
      x[i] = temp / M[i][i];
    }

    return x;
  }

  // test solution code, expect x = [2,3,-1]
  //M = [[2,1,-1,8],[-3,-1,2,-11],[-2,1,2,-3]];
  //x = mat_solve(M);
  //y = 1;  // so we have place to set a breakpoint :)

  ///////////////////////////////////////////////////////////////////////////////
  //
  //  Device base class
  //
  ////////////////////////////////////////////////////////////////////////////////

  function Device() {
  }

  // complete initial set up of device
  Device.prototype.finalize = function () {
  }

  // Load the linear elements in to Gl and C
  Device.prototype.load_linear = function (ckt) {
  }

  // load linear system equations for dc analysis
  // (inductors shorted and capacitors opened)
  Device.prototype.load_dc = function (ckt, soln, rhs) {
  }

  // load linear system equations for tran analysis
  Device.prototype.load_tran = function (ckt, soln) {
  }

  // load linear system equations for ac analysis:
  // current sources open, voltage sources shorted
  // linear models at operating point for everyone else
  Device.prototype.load_ac = function (ckt, rhs) {
  }

  // return time of next breakpoint for the device
  Device.prototype.breakpoint = function (time) {
    return undefined;
  }

  ///////////////////////////////////////////////////////////////////////////////
  //
  //  Parse numbers in engineering notation
  //
  ///////////////////////////////////////////////////////////////////////////////

  // convert first character of argument into an integer
  function ord(ch) {
    return ch.charCodeAt(0);
  }

  // convert string argument to a number, accepting usual notations
  // (hex, octal, binary, decimal, floating point) plus engineering
  // scale factors (eg, 1k = 1000.0 = 1e3).
  // return default if argument couldn't be interpreted as a number
  function parse_number(s, default_v) {
    var slen = s.length;
    var multiplier = 1;
    var result = 0;
    var index = 0;

    // skip leading whitespace
    while (index < slen && s.charAt(index) <= ' ') index += 1;
    if (index == slen) return default_v;

    // check for leading sign
    if (s.charAt(index) == '-') {
      multiplier = -1;
      index += 1;
    } else if (s.charAt(index) == '+')
      index += 1;
    var start = index;   // remember where digits start

    // if leading digit is 0, check for hex, octal or binary notation
    if (index >= slen) return default_v;
    else if (s.charAt(index) == '0') {
      index += 1;
      if (index >= slen) return 0;
      if (s.charAt(index) == 'x' || s.charAt(index) == 'X') { // hex
        while (true) {
          index += 1;
          if (index >= slen) break;
          if (s.charAt(index) >= '0' && s.charAt(index) <= '9')
            result = result * 16 + ord(s.charAt(index)) - ord('0');
          else if (s.charAt(index) >= 'A' && s.charAt(index) <= 'F')
            result = result * 16 + ord(s.charAt(index)) - ord('A') + 10;
          else if (s.charAt(index) >= 'a' && s.charAt(index) <= 'f')
            result = result * 16 + ord(s.charAt(index)) - ord('a') + 10;
          else break;
        }
        return result * multiplier;
      } else if (s.charAt(index) == 'b' || s.charAt(index) == 'B') {  // binary
        while (true) {
          index += 1;
          if (index >= slen) break;
          if (s.charAt(index) >= '0' && s.charAt(index) <= '1')
            result = result * 2 + ord(s.charAt(index)) - ord('0');
          else break;
        }
        return result * multiplier;
      } else if (s.charAt(index) != '.') { // octal
        while (true) {
          if (s.charAt(index) >= '0' && s.charAt(index) <= '7')
            result = result * 8 + ord(s.charAt(index)) - ord('0');
          else break;
          index += 1;
          if (index >= slen) break;
        }
        return result * multiplier;
      }
    }
    // read decimal integer or floating-point number
    while (true) {
      if (s.charAt(index) >= '0' && s.charAt(index) <= '9')
        result = result * 10 + ord(s.charAt(index)) - ord('0');
      else break;
      index += 1;
      if (index >= slen) break;
    }

    // fractional part?
    if (index < slen && s.charAt(index) == '.') {
      while (true) {
        index += 1;
        if (index >= slen) break;
        if (s.charAt(index) >= '0' && s.charAt(index) <= '9') {
          result = result * 10 + ord(s.charAt(index)) - ord('0');
          multiplier *= 0.1;
        } else break;
      }
    }

    // if we haven't seen any digits yet, don't check
    // for exponents or scale factors
    if (index == start) return default_v;

    // type of multiplier determines type of result:
    // multiplier is a float if we've seen digits past
    // a decimal point, otherwise it's an int or long.
    // Up to this point result is an int or long.
    result *= multiplier;

    // now check for exponent or engineering scale factor.  If there
    // is one, result will be a float.
    if (index < slen) {
      var scale = s.charAt(index);
      index += 1;
      if (scale == 'e' || scale == 'E') {
        var exponent = 0;
        multiplier = 10.0;
        if (index < slen) {
          if (s.charAt(index) == '+') index += 1;
          else if (s.charAt(index) == '-') {
            index += 1;
            multiplier = 0.1;
          }
        }
        while (index < slen) {
          if (s.charAt(index) >= '0' && s.charAt(index) <= '9') {
            exponent = exponent * 10 + ord(s.charAt(index)) - ord('0');
            index += 1;
          } else break;
        }
        while (exponent > 0) {
          exponent -= 1;
          result *= multiplier;
        }
      } else if (scale == 't' || scale == 'T') result *= 1e12;
      else if (scale == 'g' || scale == 'G') result *= 1e9;
      else if (scale == 'M') result *= 1e6;
      else if (scale == 'k' || scale == 'K') result *= 1e3;
      else if (scale == 'm') result *= 1e-3;
      else if (scale == 'u' || scale == 'U') result *= 1e-6;
      else if (scale == 'n' || scale == 'N') result *= 1e-9;
      else if (scale == 'p' || scale == 'P') result *= 1e-12;
      else if (scale == 'f' || scale == 'F') result *= 1e-15;
    }
    // ignore any remaining chars, eg, 1kohms returns 1000
    return result;
  }

  Circuit.prototype.parse_number = parse_number;  // make it easy to call from outside

  ///////////////////////////////////////////////////////////////////////////////
  //
  //  Sources
  //
  ///////////////////////////////////////////////////////////////////////////////

  // argument is a string describing the source's value (see comments for details)
  // source types: dc,step,square,triangle,sin,pulse,pwl,pwl_repeating

  // returns an object with the following attributes:
  //   fun -- name of source function
  //   args -- list of argument values
  //   value(t) -- compute source value at time t
  //   inflection_point(t) -- compute time after t when a time point is needed
  //   dc -- value at time 0
  //   period -- repeat period for periodic sources (0 if not periodic)

  function parse_source(v) {
    // generic parser: parse v as either <value> or <fun>(<value>,...)
    var src = {};
    src.period = 0; // Default not periodic
    src.value = function (t) {
      return 0;
    }  // overridden below
    src.inflection_point = function (t) {
      return undefined;
    };  // may be overridden below

    // see if there's a "(" in the description
    var index = v.indexOf('(');
    var ch;
    if (index >= 0) {
      src.fun = v.slice(0, index);   // function name is before the "("
      src.args = [];	// we'll push argument values onto this list
      var end = v.indexOf(')', index);
      if (end == -1) end = v.length;

      index += 1;     // start parsing right after "("
      while (index < end) {
        // figure out where next argument value starts
        ch = v.charAt(index);
        if (ch <= ' ') {
          index++;
          continue;
        }
        // and where it ends
        var arg_end = v.indexOf(',', index);
        if (arg_end == -1) arg_end = end;
        // parse and save result in our list of arg values
        src.args.push(parse_number(v.slice(index, arg_end), undefined));
        index = arg_end + 1;
      }
    } else {
      src.fun = 'dc';
      src.args = [parse_number(v, 0)];
    }

    // post-processing for constant sources
    // dc(v)
    if (src.fun == 'dc') {
      var v = arg_value(src.args, 0, 0);
      src.args = [v];
      src.value = function (t) {
        return v;
      }  // closure
    }

    // post-processing for impulse sources
    // impulse(height,width)
    else if (src.fun == 'impulse') {
      var h = arg_value(src.args, 0, 1);  // default height: 1
      var w = Math.abs(arg_value(src.args, 2, 1e-9));  // default width: 1ns
      src.args = [h, w];  // remember any defaulted values
      pwl_source(src, [0, 0, w / 2, h, w, 0], false);
    }

    // post-processing for step sources
    // step(v_init,v_plateau,t_delay,t_rise)
    else if (src.fun == 'step') {
      var v1 = arg_value(src.args, 0, 0);  // default init value: 0V
      var v2 = arg_value(src.args, 1, 1);  // default plateau value: 1V
      var td = Math.max(0, arg_value(src.args, 2, 0));  // time step starts
      var tr = Math.abs(arg_value(src.args, 3, 1e-9));  // default rise time: 1ns
      src.args = [v1, v2, td, tr];  // remember any defaulted values
      pwl_source(src, [td, v1, td + tr, v2], false);
    }

    // post-processing for square wave
    // square(v_init,v_plateau,freq,duty_cycle)
    else if (src.fun == 'square') {
      var v1 = arg_value(src.args, 0, 0);  // default init value: 0V
      var v2 = arg_value(src.args, 1, 1);  // default plateau value: 1V
      var freq = Math.abs(arg_value(src.args, 2, 1));  // default frequency: 1Hz
      var duty_cycle = Math.min(100, Math.abs(arg_value(src.args, 3, 50)));  // default duty cycle: 0.5
      src.args = [v1, v2, freq, duty_cycle];  // remember any defaulted values

      var per = freq == 0 ? Infinity : 1 / freq;
      var t_change = 0.01 * per;   // rise and fall time
      var t_pw = .01 * duty_cycle * 0.98 * per;  // fraction of cycle minus rise and fall time
      pwl_source(src, [0, v1, t_change, v2, t_change + t_pw,
        v2, t_change + t_pw + t_change, v1, per, v1], true);
    }

    // post-processing for triangle
    // triangle(v_init,v_plateua,t_period)
    else if (src.fun == 'triangle') {
      var v1 = arg_value(src.args, 0, 0);  // default init value: 0V
      var v2 = arg_value(src.args, 1, 1);  // default plateau value: 1V
      var freq = Math.abs(arg_value(src.args, 2, 1));  // default frequency: 1s
      src.args = [v1, v2, freq];  // remember any defaulted values

      var per = freq == 0 ? Infinity : 1 / freq;
      pwl_source(src, [0, v1, per / 2, v2, per, v1], true);
    }

    // post-processing for pwl and pwlr sources
    // pwl[r](t1,v1,t2,v2,...)
    else if (src.fun == 'pwl' || src.fun == 'pwl_repeating') {
      pwl_source(src, src.args, src.fun == 'pwl_repeating');
    }

    // post-processing for pulsed sources
    // pulse(v_init,v_plateau,t_delay,t_rise,t_fall,t_width,t_period)
    else if (src.fun == 'pulse') {
      var v1 = arg_value(src.args, 0, 0);  // default init value: 0V
      var v2 = arg_value(src.args, 1, 1);  // default plateau value: 1V
      var td = Math.max(0, arg_value(src.args, 2, 0));  // time pulse starts
      var tr = Math.abs(arg_value(src.args, 3, 1e-9));  // default rise time: 1ns
      var tf = Math.abs(arg_value(src.args, 4, 1e-9));  // default rise time: 1ns
      var pw = Math.abs(arg_value(src.args, 5, 1e9));  // default pulse width: "infinite"
      var per = Math.abs(arg_value(src.args, 6, 1e9));  // default period: "infinite"
      src.args = [v1, v2, td, tr, tf, pw, per];

      var t1 = td;       // time when v1 -> v2 transition starts
      var t2 = t1 + tr;  // time when v1 -> v2 transition ends
      var t3 = t2 + pw;  // time when v2 -> v1 transition starts
      var t4 = t3 + tf;  // time when v2 -> v1 transition ends

      pwl_source(src, [t1, v1, t2, v2, t3, v2, t4, v1, per, v1], true);
    }

    // post-processing for sinusoidal sources
    // sin(v_offset,v_amplitude,freq_hz,t_delay,phase_offset_degrees)
    else if (src.fun == 'sin') {
      var voffset = arg_value(src.args, 0, 0);  // default offset voltage: 0V
      var va = arg_value(src.args, 1, 1);  // default amplitude: -1V to 1V
      var freq = Math.abs(arg_value(src.args, 2, 1));  // default frequency: 1Hz
      src.period = 1.0 / freq;

      var td = Math.max(0, arg_value(src.args, 3, 0));  // default time delay: 0sec
      var phase = arg_value(src.args, 4, 0);  // default phase offset: 0 degrees
      src.args = [voffset, va, freq, td, phase];

      phase /= 360.0;

      // return value of source at time t
      src.value = function (t) {  // closure
        if (t < td) return voffset + va * Math.sin(2 * Math.PI * phase);
        else return voffset + va * Math.sin(2 * Math.PI * (freq * (t - td) + phase));
      }

      // return time of next inflection point after time t
      src.inflection_point = function (t) {	// closure
        if (t < td) return td;
        else return undefined;
      }
    }

    // object has all the necessary info to compute the source value and inflection points
    src.dc = src.value(0);   // DC value is value at time 0
    return src;
  }

  function pwl_source(src, tv_pairs, repeat) {
    var nvals = tv_pairs.length;
    if (repeat)
      src.period = tv_pairs[nvals - 2];  // Repeat period of source
    if (nvals % 2 == 1) npts -= 1;  // make sure it's even!

    if (nvals <= 2) {
      // handle degenerate case
      src.value = function (t) {
        return nvals == 2 ? tv_pairs[1] : 0;
      }
      src.inflection_point = function (t) {
        return undefined;
      }
    } else {
      src.value = function (t) { // closure
        if (repeat)
        // make time periodic if values are to be repeated
          t = Math.fmod(t, tv_pairs[nvals - 2]);
        var last_t = tv_pairs[0];
        var last_v = tv_pairs[1];
        if (t > last_t) {
          var next_t, next_v;
          for (var i = 2; i < nvals; i += 2) {
            next_t = tv_pairs[i];
            next_v = tv_pairs[i + 1];
            if (next_t > last_t)  // defend against bogus tv pairs
              if (t < next_t)
                return last_v + (next_v - last_v) * (t - last_t) / (next_t - last_t);
            last_t = next_t;
            last_v = next_v;
          }
        }
        return last_v;
      }
      src.inflection_point = function (t) {  // closure
        if (repeat)
        // make time periodic if values are to be repeated
          t = Math.fmod(t, tv_pairs[nvals - 2]);
        for (var i = 0; i < nvals; i += 2) {
          var next_t = tv_pairs[i];
          if (t < next_t) return next_t;
        }
        return undefined;
      }
    }
  }

  // helper function: return args[index] if present, else default_v
  function arg_value(args, index, default_v) {
    if (index < args.length) {
      var result = args[index];
      if (result === undefined) result = default_v;
      return result;
    } else return default_v;
  }

  // we need fmod in the Math library!
  Math.fmod = function (numerator, denominator) {
    var quotient = Math.floor(numerator / denominator);
    return numerator - quotient * denominator;
  }

  ///////////////////////////////////////////////////////////////////////////////
  //
  //  Sources
  //
  ///////////////////////////////////////////////////////////////////////////////

  function VSource(npos, nneg, branch, v) {
    Device.call(this);
    this.src = parse_source(v);
    this.npos = npos;
    this.nneg = nneg;
    this.branch = branch;
  }

  VSource.prototype = new Device();
  VSource.prototype.constructor = VSource;

  // load linear part for source evaluation
  VSource.prototype.load_linear = function (ckt) {
    // MNA stamp for independent voltage source
    ckt.add_to_Gl(this.branch, this.npos, 1.0);
    ckt.add_to_Gl(this.branch, this.nneg, -1.0);
    ckt.add_to_Gl(this.npos, this.branch, 1.0);
    ckt.add_to_Gl(this.nneg, this.branch, -1.0);
  }

  // Source voltage added to b.
  VSource.prototype.load_dc = function (ckt, soln, rhs) {
    ckt.add_to_rhs(this.branch, this.src.dc, rhs);
  }

  // Load time-dependent value for voltage source for tran
  VSource.prototype.load_tran = function (ckt, soln, rhs, time) {
    ckt.add_to_rhs(this.branch, this.src.value(time), rhs);
  }

  // return time of next breakpoint for the device
  VSource.prototype.breakpoint = function (time) {
    return this.src.inflection_point(time);
  }

  // small signal model ac value
  VSource.prototype.load_ac = function (ckt, rhs) {
    ckt.add_to_rhs(this.branch, 1.0, rhs);
  }

  function ISource(npos, nneg, v) {
    Device.call(this);
    this.src = parse_source(v);
    this.npos = npos;
    this.nneg = nneg;
  }

  ISource.prototype = new Device();
  ISource.prototype.constructor = ISource;

  ISource.prototype.load_linear = function (ckt) {
    // Current source is open when off, no linear contribution
  }

  // load linear system equations for dc analysis
  ISource.prototype.load_dc = function (ckt, soln, rhs) {
    var is = this.src.dc;

    // MNA stamp for independent current source
    ckt.add_to_rhs(this.npos, -is, rhs);  // current flow into npos
    ckt.add_to_rhs(this.nneg, is, rhs);   // and out of nneg
  }

  // load linear system equations for tran analysis (just like DC)
  ISource.prototype.load_tran = function (ckt, soln, rhs, time) {
    var is = this.src.value(time);

    // MNA stamp for independent current source
    ckt.add_to_rhs(this.npos, -is, rhs);  // current flow into npos
    ckt.add_to_rhs(this.nneg, is, rhs);   // and out of nneg
  }

  // return time of next breakpoint for the device
  ISource.prototype.breakpoint = function (time) {
    return this.src.inflection_point(time);
  }

  // small signal model: open circuit
  ISource.prototype.load_ac = function (ckt, rhs) {
    // MNA stamp for independent current source
    ckt.add_to_rhs(this.npos, -1.0, rhs);  // current flow into npos
    ckt.add_to_rhs(this.nneg, 1.0, rhs);   // and out of nneg
  }

  ///////////////////////////////////////////////////////////////////////////////
  //
  //  Resistor
  //
  ///////////////////////////////////////////////////////////////////////////////

  function Resistor(n1, n2, v) {
    Device.call(this);
    this.n1 = n1;
    this.n2 = n2;
    this.g = 1.0 / v;
  }

  Resistor.prototype = new Device();
  Resistor.prototype.constructor = Resistor;

  Resistor.prototype.load_linear = function (ckt) {
    // MNA stamp for admittance g
    ckt.add_conductance_l(this.n1, this.n2, this.g);
  }

  Resistor.prototype.load_dc = function (ckt) {
    // Nothing to see here, move along.
  }

  Resistor.prototype.load_tran = function (ckt, soln) {
  }

  Resistor.prototype.load_ac = function (ckt) {
  }

  ///////////////////////////////////////////////////////////////////////////////
  //
  //  Diode
  //
  ///////////////////////////////////////////////////////////////////////////////

  function Diode(n1, n2, v, type) {
    Device.call(this);
    this.anode = n1;
    this.cathode = n2;
    this.area = v;
    this.type = type;  // 'normal' or 'ideal'
    this.is = 1.0e-14;
    this.ais = this.area * this.is;
    this.vt = (type == 'normal') ? 25.8e-3 : 0.1e-3;  // 26mv or .1mv
    this.exp_arg_max = 50;  // less than single precision max.
    this.exp_max = Math.exp(this.exp_arg_max);
  }

  Diode.prototype = new Device();
  Diode.prototype.constructor = Diode;

  Diode.prototype.load_linear = function (ckt) {
    // Diode is not linear, has no linear piece.
  }

  Diode.prototype.load_dc = function (ckt, soln, rhs) {
    var vd = ckt.get_two_terminal(this.anode, this.cathode, soln);
    var exp_arg = vd / this.vt;
    var temp1, temp2;
    // Estimate exponential with a quadratic if arg too big.
    var abs_exp_arg = Math.abs(exp_arg);
    var d_arg = abs_exp_arg - this.exp_arg_max;
    if (d_arg > 0) {
      var quad = 1 + d_arg + 0.5 * d_arg * d_arg;
      temp1 = this.exp_max * quad;
      temp2 = this.exp_max * (1 + d_arg);
    } else {
      temp1 = Math.exp(abs_exp_arg);
      temp2 = temp1;
    }
    if (exp_arg < 0) {  // Use exp(-x) = 1.0/exp(x)
      temp1 = 1.0 / temp1;
      temp2 = (temp1 * temp2) * temp1;
    }
    var id = this.ais * (temp1 - 1);
    var gd = this.ais * (temp2 / this.vt);

    // MNA stamp for independent current source
    ckt.add_to_rhs(this.anode, -id, rhs);  // current flows into anode
    ckt.add_to_rhs(this.cathode, id, rhs);   // and out of cathode
    ckt.add_conductance(this.anode, this.cathode, gd);
  }

  Diode.prototype.load_tran = function (ckt, soln, rhs, time) {
    this.load_dc(ckt, soln, rhs);
  }

  Diode.prototype.load_ac = function (ckt) {
  }


  ///////////////////////////////////////////////////////////////////////////////
  //
  //  Capacitor
  //
  ///////////////////////////////////////////////////////////////////////////////

  function Capacitor(n1, n2, v) {
    Device.call(this);
    this.n1 = n1;
    this.n2 = n2;
    this.value = v;
  }

  Capacitor.prototype = new Device();
  Capacitor.prototype.constructor = Capacitor;

  Capacitor.prototype.load_linear = function (ckt) {
    // MNA stamp for capacitance matrix
    ckt.add_capacitance(this.n1, this.n2, this.value);
  }

  Capacitor.prototype.load_dc = function (ckt, soln, rhs) {
  }

  Capacitor.prototype.load_ac = function (ckt) {
  }

  Capacitor.prototype.load_tran = function (ckt) {
  }

  ///////////////////////////////////////////////////////////////////////////////
  //
  //  Inductor
  //
  ///////////////////////////////////////////////////////////////////////////////

  function Inductor(n1, n2, branch, v) {
    Device.call(this);
    this.n1 = n1;
    this.n2 = n2;
    this.branch = branch;
    this.value = v;
  }

  Inductor.prototype = new Device();
  Inductor.prototype.constructor = Inductor;

  Inductor.prototype.load_linear = function (ckt) {
    // MNA stamp for inductor linear part
    // L on diag of C because L di/dt = v(n1) - v(n2)
    ckt.add_to_Gl(this.n1, this.branch, 1);
    ckt.add_to_Gl(this.n2, this.branch, -1);
    ckt.add_to_Gl(this.branch, this.n1, -1);
    ckt.add_to_Gl(this.branch, this.n2, 1);
    ckt.add_to_C(this.branch, this.branch, this.value)
  }

  Inductor.prototype.load_dc = function (ckt, soln, rhs) {
    // Inductor is a short at dc, so is linear.
  }

  Inductor.prototype.load_ac = function (ckt) {
  }

  Inductor.prototype.load_tran = function (ckt) {
  }


  ///////////////////////////////////////////////////////////////////////////////
  //
  //  Simple Voltage-Controlled Voltage Source Op Amp model
  //
  ///////////////////////////////////////////////////////////////////////////////

  function Opamp(np, nn, no, ng, branch, A, name) {
    Device.call(this);
    this.np = np;
    this.nn = nn;
    this.no = no;
    this.ng = ng;
    this.branch = branch;
    this.gain = A;
    this.name = name;
  }

  Opamp.prototype = new Device();
  Opamp.prototype.constructor = Opamp;
  Opamp.prototype.load_linear = function (ckt) {
    // MNA stamp for VCVS: 1/A(v(no) - v(ng)) - (v(np)-v(nn))) = 0.
    var invA = 1.0 / this.gain;
    ckt.add_to_Gl(this.no, this.branch, 1);
    ckt.add_to_Gl(this.ng, this.branch, -1);
    ckt.add_to_Gl(this.branch, this.no, invA);
    ckt.add_to_Gl(this.branch, this.ng, -invA);
    ckt.add_to_Gl(this.branch, this.np, -1);
    ckt.add_to_Gl(this.branch, this.nn, 1);
  }

  Opamp.prototype.load_dc = function (ckt, soln, rhs) {
    // Op-amp is linear.
  }

  Opamp.prototype.load_ac = function (ckt) {
  }

  Opamp.prototype.load_tran = function (ckt) {
  }

  ///////////////////////////////////////////////////////////////////////////////
  //
  //  Simplified MOS FET with no bulk connection and no body effect.
  //
  ///////////////////////////////////////////////////////////////////////////////

  function Fet(d, g, s, ratio, name, type) {
    Device.call(this);
    this.d = d;
    this.g = g;
    this.s = s;
    this.name = name;
    this.ratio = ratio;
    if (type != 'n' && type != 'p') {
      throw 'fet type is not n or p';
    }
    this.type_sign = (type == 'n') ? 1 : -1;
    this.vt = 0.5;
    this.kp = 20e-6;
    this.beta = this.kp * this.ratio;
    this.lambda = 0.05;
  }

  Fet.prototype = new Device();
  Fet.prototype.constructor = Fet;

  Fet.prototype.load_linear = function (ckt) {
    // FET's are nonlinear, just like javascript progammers
  }

  Fet.prototype.load_dc = function (ckt, soln, rhs) {
    var vds = this.type_sign * ckt.get_two_terminal(this.d, this.s, soln);
    if (vds < 0) { // Drain and source have swapped roles
      var temp = this.d;
      this.d = this.s;
      this.s = temp;
      vds = this.type_sign * ckt.get_two_terminal(this.d, this.s, soln);
    }
    var vgs = this.type_sign * ckt.get_two_terminal(this.g, this.s, soln);
    var vgst = vgs - this.vt;
    with (this) {
      var gmgs, ids, gds;
      if (vgst > 0.0) { // vgst < 0, transistor off, no subthreshold here.
        if (vgst < vds) { /* Saturation. */
          gmgs = beta * (1 + (lambda * vds)) * vgst;
          ids = type_sign * 0.5 * gmgs * vgst;
          gds = 0.5 * beta * vgst * vgst * lambda;
        } else {  /* Linear region */
          gmgs = beta * (1 + lambda * vds);
          ids = type_sign * gmgs * vds * (vgst - 0.50 * vds);
          gds = gmgs * (vgst - vds) + beta * lambda * vds * (vgst - 0.5 * vds);
          gmgs *= vds;
        }
        ckt.add_to_rhs(d, -ids, rhs);  // current flows into the drain
        ckt.add_to_rhs(s, ids, rhs);   // and out the source
        ckt.add_conductance(d, s, gds);
        ckt.add_to_G(s, s, gmgs);
        ckt.add_to_G(d, s, -gmgs);
        ckt.add_to_G(d, g, gmgs);
        ckt.add_to_G(s, g, -gmgs);
      }
    }
  }

  Fet.prototype.load_tran = function (ckt, soln, rhs) {
    this.load_dc(ckt, soln, rhs);
  }

  Fet.prototype.load_ac = function (ckt) {
  }


  ///////////////////////////////////////////////////////////////////////////////
  //
  //  Module definition
  //
  ///////////////////////////////////////////////////////////////////////////////
  var module = {
    'Circuit': Circuit,
    'parse_number': parse_number,
    'parse_source': parse_source
  }
  return module;
}());

/////////////////////////////////////////////////////////////////////////////
//
//  Simple schematic capture
//
////////////////////////////////////////////////////////////////////////////////

// Copyright (C) 2011 Massachusetts Institute of Technology

// add schematics to a document with
//
//   <input type="hidden" class="schematic" name="unique_form_id" value="JSON netlist..." .../>
//
// other attributes you can add to the input tag:
//   width -- width in pixels of diagram
//   height -- height//  sch :=  [part, part, ...]
//  part := [type, coords, properties, connections]
//  type := string (see parts_map)
//  coords := [number, ...]  // (x,y,rot) or (x1,y1,x2,y2)
//  properties := {name: value, ...}
//  connections := [node, ...]   // one per connection point in canoncial order
//  node := string
// need a netlist? just use the part's type, properites and connections

// TO DO:
// - wire labels?
// - zoom/scroll canvas
// - rotate multiple objects around their center of mass
// - rubber band wires when moving components

// set up each schematic entry widget
function update_schematics() {
  // set up each schematic on the page
  //var schematics = $('.schematic');
  var schematics = document.getElementsByClassName('schematic');	//WMc restored from MIT version

  for (var i = 0; i < schematics.length; ++i)
    if (schematics[i].getAttribute("loaded") != "true") {
      try {
        new schematic.Schematic(schematics[i]);
      } catch (err) {
        console.log("error when loading compoenent");
        var msgdiv = document.createElement('div');
        msgdiv.style.border = 'thick solid #FF0000';
        msgdiv.style.margins = '20px';
        msgdiv.style.padding = '20px';
        var msg = document.createTextNode('Sorry, there a browser error in starting the schematic tool.');
        msgdiv.appendChild(msg);
        schematics[i].parentNode.insertBefore(msgdiv, schematics[i]);
      }
      schematics[i].setAttribute("loaded", "true");
    }
}

window.update_schematics = update_schematics;

// add ourselves to the tasks that get performed when window is loaded
function add_schematic_handler(other_onload) {
  return function () {
    // execute other onload functions first
    if (other_onload) other_onload();

    update_schematics();
  }
}

// WMc The window.onload line below was removed by EdX (SJSU), with the following warning
/*
 + * THK: Attaching update_schematic to window.onload is rather presumptuous...
 + *      The function is called for EVERY page load, whether in courseware or in
 + *      course info, in 6.002x or the public health course. It is also redundant
 + *      because courseware includes an explicit call to update_schematic after
 + *      each ajax exchange. In this case, calling update_schematic twice appears
 + *      to contribute to a bug in Firefox that does not render the schematic
 + *      properly depending on timing.
 */
window.onload = add_schematic_handler(window.onload);	// restored from earlier EdX version

// ask each schematic input widget to update its value field for submission
/*function prepare_schematics() {						// not used
 var schematics = $('.schematic');
 for (var i = schematics.length - 1; i >= 0; i--)
 schematics[i].schematic.update_value();
 } */

// URL of ciruit sandbox simluator, used to create shareable link.


// from: http://stackoverflow.com/questions/901115/how-can-i-get-query-string-values-in-javascript
function getURLParameterByName(name, url) {
  if (!url) {
    url = window.location.href;
  }
  name = name.replace(/[\[\]]/g, "\\$&");
  var regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)"),
    results = regex.exec(url);
  if (!results) return null;
  if (!results[2]) return '';
  return decodeURIComponent(results[2].replace(/\+/g, " "));
}


schematic = (function () {
  var element_style = 'rgb(255,255,255)';
  var background_style = 'rgb(246,247,247)';	// KA gray97 #F6F7F7
  var grid_style = 'rgb(246,247,247)';		// KA gray97 #F6F7F7
  var border_style = 'rgb(214,216,218)';		// KA gray85 #D6D8DA
  var stroke_style = 'rgb(186,190,194)';		// KA gray76 #BABEC2 on-schematic icons
  var normal_style = 'rgb(0,0,0)';  			// black wire drawing color
  var component_style = 'rgb(60,145,229)';  	// KA default5 #3C91E5 unselected components
  var selected_style = 'rgb(116,207,112)';	// KA CS2 #74CF70 highlight selected components
  var icon_style = 'rgb(33,36,44)';			// KA gray17 #21242C main menu icons
  var annotation_style = 'rgb(249,104,93)';	// KA humanities5 #F9685D v and i annotations
  var cancel_style = 'rgb(186,190,194)';		// KA gray76 #BABEC2 cancel X icon
  var ok_style = 'rgb(113,179,7)';			// KA Exerxise #71B307 ok checkmark icon
  var property_size = 7;  					// point size for Component property text
  var annotation_size = 7;  					// point size for diagram annotations

  var parts_map = {
    'g': [Ground, i18n.Ground_connection],
    'L': [Label, i18n.Node_label],
    'v': [VSource, i18n.Voltage_source],
    'i': [ISource, i18n.Current_source],
    'r': [Resistor, i18n.Resistor],
    'c': [Capacitor, i18n.Capacitor],
    'l': [Inductor, i18n.Inductor],
    'o': [OpAmp, i18n.Op_Amp],
    'd': [Diode, i18n.Diode],
    'n': [NFet, i18n.NFet],
    'p': [PFet, i18n.PFet],
    's': [Probe, i18n.Voltage_probe],
    'a': [Ammeter, i18n.Current_probe],
    't': [CLabel , i18n.Custom_Label]
  };

  // global clipboard
  if (typeof sch_clipboard == 'undefined')
    sch_clipboard = [];

  ///////////////////////////////////////////////////////////////////////////////
  //
  //  Schematic = diagram + parts bin + status area
  //
  ////////////////////////////////////////////////////////////////////////////////

  // setup a schematic by populating the <div> with the appropriate children
  function Schematic(input) {
    // set up diagram viewing parameters

    this.show_grid = true;
    this.grid = 8;
    this.scale = 2;
    this.origin_x = input.getAttribute("origin_x");
    if (this.origin_x == undefined) this.origin_x = 0;
    this.origin_y = input.getAttribute("origin_y");
    if (this.origin_y == undefined) this.origin_y = 0;
    this.cursor_x = 0;
    this.cursor_y = 0;
    this.window_list = [];  // list of pop-up windows in increasing z order
    this.is_question = false;// if is true chapter 1 is loaded
    // use user-supplied list of parts if supplied
    // else just populate parts bin with all the parts
    this.allow_edits = true;
    this.is_static = false ; // this is for chapter one
    this.input = input;
    this.parts = []; // representation with mnemonics ex Resistor : R , Capacitor C ...
      this.analyses = [];// full array = ['dc', 'ac', 'tran']
    this.parts_bin = [];
    this.submit_analyses = undefined;
    // toolbar
    this.tools = [];
    this.toolbar = [];
    this.custom_table = undefined;

    /* this is the part of functions */
    this.on_click_component = function (t) {};
    this.on_double_click_component = function(t){};

    // list of the parts object
    /*
        if (is_question == undefined || is_question == "None" || is_question.toLocaleLowerCase() != "true") {

            this.is_question = false;
        }
        else {
            this.is_question = true; // the mode is chapter 1
        }*/
    //this.update_schematic1 ();
    // set up schematic diagram canvas
  }

  var part_w = 42;   // size of a parts bin compartment
  var part_h = 42;
  Schematic.prototype.update_parts = function () {
    //this.parts_bin = [];
    for (var i = 0; i < this.parts.length; i++) {
      var part = new Part(this);
      var pm = parts_map[this.parts[i]];
      //console.log(pm);
      part.set_component(new pm[0](0, 0, 0), pm[1]);
      this.parts_bin.push(part);
    }

  }
  Schematic.prototype.update_schematic1 = function () {



    // this.parts = this.input.getAttribute('parts');
    /* if (this.parts == undefined || this.parts == 'None') {
              this.parts = [];
              for (var p in parts_map) this.parts.push(p);
          } else if (this.parts == '') {
              this.allow_edits = false;
              this.parts = [];
          } else this.parts = this.parts.split(',');
          */
    // now add the parts to the parts bin
    this.update_parts();
    // use user-supplied list of analyses, otherwise provide them all
    // analyses="" means no analyses
    /*  this.analyses = this.input.getAttribute('analyses');
          if (this.analyses == undefined || this.analyses == 'None')
              this.analyses = ['dc', 'ac', 'tran'];
          else if (this.analyses == '') this.analyses = [];
          else this.analyses = this.analyses.split(',');
          */
    //if (this.parts.length == 0 && this.analyses.length == 0) this.diagram_only = true;
    //else this.diagram_only = false;

    // see what we need to submit.  Expecting attribute of the form
    // submit_analyses="{'tran':[[node_name,t1,t2,t3],...],
    //                   'ac':[[node_name,f1,f2,...],...]}"
    /*var submit = this.input.getAttribute('submit_analyses');

    if (submit && submit.indexOf('{') != -1)
      this.submit_analyses = JSON.parse(submit);
    else
      this.submit_analyses = undefined;

    // toolbar
    this.tools = [];
    this.toolbar = [];
    */
    /*if (!this.diagram_only) {
      this.tools['help'] = this.add_tool(help_icon,i18n.Help,this.help);
      this.enable_tool('help', true);
    }*/
    if (this.allow_edits) {

      //this.tools['grid'] = this.add_tool(grid_icon,i18n.Grid,this.toggle_grid);
      //this.enable_tool('grid',true);
      //this.tools['open'] = this.add_tool(open_icon,i18n.Open_netlist,this.open_netlist);
      //this.enable_tool('open',true);

      //this.tools['link'] = this.add_tool(link_icon,i18n.Link_tip,this.share_link);
      //this.enable_tool('link',true);

      //this.tools['save'] = this.add_tool(save_icon,i18n.Save_netlist,this.save_netlist);
      //this.enable_tool('save',true);

      this.tools['cut'] = this.add_tool(cut_icon, i18n.Cut, this.cut);
      this.tools['copy'] = this.add_tool(copy_icon, i18n.Copy, this.copy);
      this.tools['paste'] = this.add_tool(paste_icon, i18n.Paste, this.paste);

      this.tools['delete'] = this.add_tool(delete_icon, i18n.Delete, this.delete_selected);
      this.tools['rotate'] = this.add_tool(rotate_icon, i18n.Rotate, this.rotate_selected);
      this.tools['spacer'] = this.add_tool(spacer_icon, '', this.rotate_selected);
    }


    if (typeof cktsim != 'undefined') {
      if (this.analyses.indexOf('dc') != -1) {
        this.tools['dc'] = this.add_tool('DC', i18n.Perform_DC_Analysis, this.dc_analysis);
        this.enable_tool('dc', true);
        this.dc_max_iters = '1000';  // default values dc solution
      }

      if (this.analyses.indexOf('ac') != -1) {
        this.tools['ac'] = this.add_tool('AC', i18n.Perform_AC_Analysis, this.setup_ac_analysis);
        this.enable_tool('ac', true);
        this.ac_npts = '50'; // default values for AC Analysis
        this.ac_fstart = '10';
        this.ac_fstop = '1G';
        this.ac_source_name = undefined;
      }

      if (this.analyses.indexOf('tran') != -1) {
        this.tools['tran'] = this.add_tool('TRAN', i18n.Perform_Transient_Analysis, this.transient_analysis);
        this.enable_tool('tran', true);
        this.tran_npts = '100';  // default values for transient analysis
        this.tran_tstop = '0.01';
      }
    }


    this.canvas = document.createElement('canvas');
    this.width = this.input.getAttribute('width');
    //  consol.log(this.width);
    this.width = parseInt(this.width == undefined ? '400' : this.width);
    this.canvas.width = this.width;
    this.height = this.input.getAttribute('height');
    this.height = parseInt(this.height == undefined ? '300' : this.height);
    this.canvas.height = this.height;
    this.canvas.style.display = 'block'; //gets rid of the little sliver of default padding at the bottom.

    this.sctl_r = 16;   				// scrolling control parameters
    this.sctl_x = this.sctl_r + 8;
    this.sctl_y = this.sctl_r + 8;

    this.zctl_x = this.sctl_x;			// zoom control parameters
    this.zctl_y = this.sctl_y + this.sctl_r + 8;
    this.zctl_w = 26;
    this.zctl_h = 3 * this.zctl_w;


    // repaint simply draws this buffer and then adds selected elements on top
    this.bg_image = document.createElement('canvas');
    this.bg_image.width = this.width;
    this.bg_image.height = this.height;

    if (!this.diagram_only) {
      this.canvas.tabIndex = 1; // so we get keystrokes
      this.canvas.style.borderStyle = 'solid';
      this.canvas.style.borderWidth = '1px';
      this.canvas.style.borderColor = border_style;
      this.canvas.style.outline = 'none';
      this.canvas.style.borderRadius = '4px';
      this.canvas.style.marginLeft = '10px';
    }

    this.canvas.schematic = this;
    if (this.allow_edits || true) {
      this.canvas.addEventListener('mousemove', function (event) {
        if (!event) event = window.event;
        var sch = event.target.schematic;

        sch.canvas.relMouseCoords(event);
        schematic_mouse_move(sch);
      }, false);

      this.canvas.addEventListener('mouseover', schematic_mouse_enter, false);
      this.canvas.addEventListener('mouseout', schematic_mouse_leave, false);

      this.canvas.addEventListener('touchmove', function (event) {
        var touch = event.changedTouches[0];

        if (!event) event = window.event;
        var sch = event.target.schematic;

        sch.canvas.relMouseCoords(touch);
        schematic_mouse_move(sch);
      }, false);

      this.canvas.addEventListener('touchend', function (event) {
        if (!event) event = window.event;
        else event.preventDefault();
        var sch = event.target.schematic;

        schematic_mouse_up(sch);
      }, false);

      this.canvas.addEventListener('touchcancel', function (event) {
        if (!event) event = window.event;
        else event.preventDefault();
        var sch = event.target.schematic;

        schematic_mouse_up(sch);
      }, false);

      //Hammer.js provides the doubletap function for mobile, as well as double-click.

      //this.canvas.addEventListener('wheel',schematic_mouse_wheel,false);		   //removed for mobile, see comment in schematic_mouse_wheel
      //this.canvas.addEventListener('DOMMouseScroll',schematic_mouse_wheel,false);  // for FF
      //this.canvas.addEventListener('dblclick',schematic_double_click,false);	   // replaced by Hammer.js
      //this.canvas.addEventListener('keydown',schematic_key_down,false);
      //this.canvas.addEventListener('keyup',schematic_key_up,false);
    }
    else///HINT in the level 1
    {

    }
      this.canvas.addEventListener('mousedown', function (event) {
        if (!event) event = window.event;

        else event.preventDefault();

        var sch = event.target.schematic;
      for(c of sch.parts_bin)
        {
         c.select(false);
        }
        // determine where event happened in schematic coordinates
        sch.canvas.relMouseCoords(event);

        schematic_mouse_down(sch);
      }, false);
      this.canvas.addEventListener('mouseup', function (event) {
        if (!event) event = window.event;
        else event.preventDefault();
        var sch = event.target.schematic;

        schematic_mouse_up(sch);
      }, false);


    this.canvas.addEventListener('touchstart', function (event) {
        var numTouch = event.changedTouches.length;
        if (numTouch >= 2) return;		//let 2 or more touches be for scrolling the window
        var touch = event.changedTouches[0];

        if (!event) event = window.event;
        else event.preventDefault();
        var sch = event.target.schematic;

        // determine where event happened in schematic coordinates
        sch.canvas.relMouseCoords(touch);

        schematic_mouse_down(sch);
      }, false);

     Hammer(this.canvas).on("doubletap", function (event) {
        var sch = event.target.schematic;

        // relMouseCoords needs to know about event.pageX and event.pageY
        // We use hammer.js' event.center and adjust for page scroll. (scroll needed?)
        event.pageX = event.center.x + document.body.scrollLeft;
        event.pageY = event.center.y + document.body.scrollTop;

        schematic_double_click(event);
      });

    // set up message area
    if (!this.diagram_only) {
      this.status_div = document.createElement('div');
      this.status = document.createTextNode('');
      this.status_div.appendChild(this.status);
      this.status_div.style.height = '18px';
      this.status_div.style.marginRight = '94px';
      this.status_div.style.textAlign = "right";
      this.status_div.style.font = '10pt sans-serif';
    } else this.status_div = undefined;

    this.connection_points = []; // location string => list of cp's
    this.components = [];
    this.dragging = false;
    this.select_rect = undefined;
    this.wire = undefined;
    this.operating_point = undefined;  // result from DC analysis
    this.dc_results = undefined;   // saved analysis results for submission
    this.ac_results = undefined;   // saved analysis results for submission
    this.transient_results = undefined;   // saved analysis results for submission

    // state of modifier keys
    this.ctrlKey = false;
    this.shiftKey = false;
    this.altKey = false;
    this.cmdKey = false;

    // make sure other code can find us!
    this.input.schematic = this;
    //this.input = input;

    // set up DOM -- use nested tables to do the layout
    var table, tr, td;
    table = document.createElement('table');
    table.rules = 'none';
    if (!this.diagram_only) {
      //table.frame = 'box';
      table.style.borderStyle = 'solid';
      table.style.borderWidth = '1px';
      table.style.borderColor = border_style;
      table.style.backgroundColor = background_style;
      table.style.borderRadius = '4px';
    }

    // add tools to DOM
    if (this.toolbar.length > 0) {
      tr = document.createElement('tr');
      table.appendChild(tr);
      td = document.createElement('td');
      td.style.verticalAlign = 'top';
      td.colSpan = 2;
      tr.appendChild(td);
      for (var i = 0; i < this.toolbar.length; ++i) {
        var tool = this.toolbar[i];
        if (tool != null) td.appendChild(tool);
      }
    }

    // add canvas and parts bin to DOM
    tr = document.createElement('tr');
    table.appendChild(tr);

    td = document.createElement('td');
    tr.appendChild(td);
    var wrapper = document.createElement('div'); // for inserting pop-up windows
    td.appendChild(wrapper);
    wrapper.style.position = 'relative';  // so we can position subwindows
    wrapper.appendChild(this.canvas);

    td = document.createElement('td');
    td.style.verticalAlign = 'top';
    tr.appendChild(td);
    var parts_table = document.createElement('table');
    td.appendChild(parts_table);
    parts_table.rules = 'none';
    parts_table.frame = 'void';
    parts_table.cellPadding = '0';
    parts_table.cellSpacing = '0';
    this.parts_table = parts_table ;

    // fill in parts_table
    var parts_per_column = Math.floor(this.height / (part_h + 5));  // mysterious extra padding
    for (var i = 0; i < parts_per_column; ++i) {
      tr = document.createElement('tr');

      parts_table.appendChild(tr);
      for (var j = i; j < this.parts_bin.length; j += parts_per_column) {
        td = document.createElement('td');
        tr.appendChild(td);
        td.appendChild(this.parts_bin[j].canvas);
      }
    }

    if (this.status_div != undefined) {
      tr = document.createElement('tr');
      table.appendChild(tr);
      td = document.createElement('td');
      tr.appendChild(td);
      td.colSpan = 2;
      td.appendChild(this.status_div);
    }

    // add to dom
    // avoid Chrome bug that changes to text cursor whenever
    // drag starts.  Just do this in schematic tool...
    var toplevel = document.createElement('div');
    toplevel.onselectstart = function () {
      return false;
    };
    toplevel.appendChild(table);
    this.input.parentNode.insertBefore(toplevel, this.input.nextSibling);

    // process initial contents of diagram
    // precedence for starting contents of diagram: level from URL, initial_value from html <input>, and finally level from html <input>
    /*var level = getURLParameterByName('level');
    console.log(level);// level = circuit string from URL
    if (level === null) {

      this.load_schematic(
        this.input.getAttribute('level'));	// level = circuit string from HTML
      //this.input.getAttribute('initial_value'));
    }
    else {

      lol = $.getJSON(level);
      console.log("hhhh	");
      this.load_schematic(level);
    }*/
    //this.load_schematic(null,null);
    // start by centering diagram on the screen
    //console.log(this.parts_bin);
    this.redraw_background();
    this.zoomall();
      //console.log(this.parts_bin);

  }

  Schematic.prototype.add_component = function (new_c) {
    this.components.push(new_c);
    // create undoable edit record here
  }

  Schematic.prototype.remove_component = function (c) {
    var index = this.components.indexOf(c);
    if (index != -1) this.components.splice(index, 1);
  }

  Schematic.prototype.find_connections = function (cp) {
    return this.connection_points[cp.location];
  }

  Schematic.prototype.add_connection_point = function (cp) {
    var cplist = this.connection_points[cp.location];
    if (cplist) cplist.push(cp);
    else {
      cplist = [cp];
      this.connection_points[cp.location] = cplist;
    }

    return cplist;
  }

  Schematic.prototype.remove_connection_point = function (cp, old_location) {
    // remove cp from list at old location
    var cplist = this.connection_points[old_location];
    if (cplist) {
      var index = cplist.indexOf(cp);
      if (index != -1) {
        cplist.splice(index, 1);
        // if no more connections at this location, remove
        // entry from array to keep our search time short
        if (cplist.length == 0)
          delete this.connection_points[old_location];
      }
    }
  }

  Schematic.prototype.update_connection_point = function (cp, old_location) {
    this.remove_connection_point(cp, old_location);
    return this.add_connection_point(cp);
  }

  Schematic.prototype.add_wire = function (x1, y1, x2, y2) {
    var new_wire = new Wire(x1, y1, x2, y2);
    new_wire.add(this);
    new_wire.move_end();
    return new_wire;
  }

  Schematic.prototype.split_wire = function (w, cp) {
    // remove bisected wire
    w.remove();

    // add two new wires with connection point cp in the middle
    this.add_wire(w.x, w.y, cp.x, cp.y);
    this.add_wire(w.x + w.dx, w.y + w.dy, cp.x, cp.y);
  }

  // see if connection points of component c split any wires
  Schematic.prototype.check_wires = function (c) {
    for (var i = 0; i < this.components.length; i++) {
      var cc = this.components[i];
      if (cc != c) {  // don't check a component against itself
        // only wires will return non-null from a bisect call
        var cp = cc.bisect(c);
        if (cp) {
          // cc is a wire bisected by connection point cp
          this.split_wire(cc, cp);
          this.redraw_background();
        }
      }
    }
  }

  // see if there are any existing connection points that bisect wire w
  Schematic.prototype.check_connection_points = function (w) {
    for (var locn in this.connection_points) {
      var cplist = this.connection_points[locn];
      if (cplist && w.bisect_cp(cplist[0])) {
        this.split_wire(w, cplist[0]);
        this.redraw_background();

        // stop here, new wires introduced by split will do their own checks
        return;
      }
    }
  }

  // merge collinear wires sharing an end point
  Schematic.prototype.clean_up_wires = function () {
    for (var locn in this.connection_points) {
      var cplist = this.connection_points[locn];
      if (cplist && cplist.length == 2) {
        // found a connection with just two connections, see if they're wires
        var c1 = cplist[0].parent;
        var c2 = cplist[1].parent;
        if (c1.type == 'w' && c2.type == 'w') {
          var e1 = c1.other_end(cplist[0]);
          var e2 = c2.other_end(cplist[1]);
          var e3 = cplist[0];  // point shared by the two wires
          if (collinear(e1, e2, e3)) {
            c1.remove();
            c2.remove();
            this.add_wire(e1.x, e1.y, e2.x, e2.y);
          }
        }
      }
    }
  }

  Schematic.prototype.unselect_all = function (which) {
    this.operating_point = undefined;  // remove annotations
    for (var i = this.components.length - 1; i >= 0; --i)
      if (i != which) this.components[i].set_select(false);
  }

  Schematic.prototype.drag_begin = function () {
    // let components know they're about to move

    for (var i = this.components.length - 1; i >= 0; --i) {
      var component = this.components[i];
      if (component.selected) component.move_begin();
    }

    // remember where drag started
    this.drag_x = this.cursor_x;
    this.drag_y = this.cursor_y;
    this.dragging = true;
  }

  Schematic.prototype.drag_end = function () {
    // let components know they're done moving
    for (var i = this.components.length - 1; i >= 0; --i) {
      var component = this.components[i];
      if (component.selected) component.move_end();
    }
    this.dragging = false;
    this.clean_up_wires();
    this.redraw_background();
  }

  Schematic.prototype.help = function () {
    /* Embedded help strings can be found in i18n strings files: en-US.js, es.js, and the like.	*/
    var strHelp = strSHelp + strAddC + strAddW + strSel + strMove + strDel + strRot + strProp + strNum;
    window.confirm(strHelp);
  }

  // zoom diagram around given coords
  Schematic.prototype.rescale = function (nscale, cx, cy) {
    if (cx == undefined) {
      // use current center point if no point has been specified
      cx = this.origin_x + this.width / (2 * this.scale);
      cy = this.origin_y + this.height / (2 * this.scale);
    }

    this.origin_x += cx * (this.scale - nscale);
    this.origin_y += cy * (this.scale - nscale);
    this.scale = nscale;
    this.redraw_background();
  }

  Schematic.prototype.toggle_grid = function () {
    this.show_grid = !this.show_grid;
    this.redraw_background();
  }

  var zoom_factor = 1.25;    // scaling is some power of zoom_factor
  //var zoom_wheel_factor = 1.05;		//removed for mobile, see comment in schematic_mouse_wheel
  var zoom_min = 0.5;
  var zoom_max = 4.0;
  var origin_min = -200;    // in grids
  var origin_max = 200;

  Schematic.prototype.zoomin = function () {
    var nscale = this.scale * zoom_factor;
    if (nscale < zoom_max) {
      // keep center of view unchanged
      this.origin_x += (this.width / 2) * (1.0 / this.scale - 1.0 / nscale);
      this.origin_y += (this.height / 2) * (1.0 / this.scale - 1.0 / nscale);
      this.scale = nscale;
      this.redraw_background();
    }
  }

  Schematic.prototype.zoomout = function () {
    var nscale = this.scale / zoom_factor;
    if (nscale > zoom_min) {
      // keep center of view unchanged
      this.origin_x += (this.width / 2) * (1.0 / this.scale - 1.0 / nscale);
      this.origin_y += (this.height / 2) * (1.0 / this.scale - 1.0 / nscale);
      this.scale = nscale;
      this.redraw_background();
    }
  }

  Schematic.prototype.zoomall = function () {
    // w,h for schematic including a 25% margin on all sides
    var sch_w = 1.5 * (this.bbox[2] - this.bbox[0]);
    var sch_h = 1.5 * (this.bbox[3] - this.bbox[1]);

    if (sch_w == 0 && sch_h == 0) {
      this.origin_x = 0;
      this.origin_y = 0;
      this.scale = 2;
    } else {
      // compute scales that would make schematic fit, choose smallest
      var scale_x = this.width / sch_w;
      var scale_y = this.height / sch_h;
      this.scale = Math.pow(zoom_factor, Math.ceil(Math.log(Math.min(scale_x, scale_y)) / Math.log(zoom_factor)));
      if (this.scale < zoom_min) this.scale = zoom_min;
      else if (this.scale > zoom_max) this.scale = zoom_max;

      // center the schematic
      this.origin_x = (this.bbox[2] + this.bbox[0]) / 2 - this.width / (2 * this.scale);
      this.origin_y = (this.bbox[3] + this.bbox[1]) / 2 - this.height / (2 * this.scale);
    }

    this.redraw_background();
  }

  Schematic.prototype.cut = function () {
    // clear previous contents
    sch_clipboard = [];

    // look for selected components, move them to clipboard.
    for (var i = this.components.length - 1; i >= 0; --i) {
      var c = this.components[i];
      if (c.selected) {
        c.remove();
        sch_clipboard.push(c);
      }
    }

    // update diagram view
    this.redraw();
  }

  Schematic.prototype.copy = function () {
    // clear previous contents
    sch_clipboard = [];

    // look for selected components, copy them to clipboard.
    for (var i = this.components.length - 1; i >= 0; --i) {
      var c = this.components[i];
      if (c.selected)
        sch_clipboard.push(c.clone(c.x, c.y));
    }
  }

  Schematic.prototype.paste = function () {
    // compute left,top of bounding box for origins of
    // components in the clipboard
    var left = undefined;
    var top = undefined;
    for (var i = sch_clipboard.length - 1; i >= 0; --i) {
      var c = sch_clipboard[i];
      left = left ? Math.min(left, c.x) : c.x;
      top = top ? Math.min(top, c.y) : c.y;
    }

    this.message('cursor ' + this.cursor_x + ',' + this.cursor_y);

    // clear current selections
    this.unselect_all(-1);
    this.redraw_background();  // so we see any components that got unselected

    // make clones of components on the clipboard, positioning
    // them relative to the cursor
    for (var i = sch_clipboard.length - 1; i >= 0; --i) {
      var c = sch_clipboard[i];
      var new_c = c.clone(this.cursor_x + (c.x - left), this.cursor_y + (c.y - top));
      new_c.set_select(true);
      new_c.add(this);
    }

    this.redraw();
  }

  Schematic.prototype.delete_selected = function () {
    // delete selected components
    for (var i = this.components.length - 1; i >= 0; --i) {
      var component = this.components[i];
      if (component.selected) component.remove();
    }
    this.clean_up_wires();
    this.redraw();
  }

  Schematic.prototype.rotate_selected = function () {
    // rotate selected components
    for (var i = this.components.length - 1; i >= 0; --i) {
      var component = this.components[i];
      if (component.selected) {
        component.rotate(1);
        this.check_wires(component);
      }
    }
    this.clean_up_wires();
    this.redraw();
  }

  ///////////////////////////////////////////////////////////////////////////////
  //
  //  Netlist and Simulation interface
  //
  ////////////////////////////////////////////////////////////////////////////////
  Schematic.prototype.get_json = function (json)
  {
     for (var i = json.length - 1; i >= 0; --i) {
        var c = json[i];
        if (c[0] == 'view') {
          this.ac_fstart = c[5];
          this.ac_fstop = c[6];
          this.ac_source_name = c[7];
          this.tran_npts = c[8];
          this.tran_tstop = c[9];
          this.dc_max_iters = c[10];
        } else if (c[0] == 'w') {
          // wire
          this.add_wire(c[1][0], c[1][1], c[1][2], c[1][3]);
        } else if (c[0] == 'dc') {
          this.dc_results = c[1];
        } else if (c[0] == 'transient') {
          this.transient_results = c[1];
        } else if (c[0] == 'ac') {
          this.ac_results = c[1];
        } else {
          // ordinary component
          //  c := [type, coords, properties, connections]
          var type = c[0];
          var coords = c[1];
          var properties = c[2];
          console.log(c);
          if (c.length < 5)
            c.push(true);
          var part = new parts_map[type][0](coords[0], coords[1], coords[2]);
          for (var name in properties)
            part.properties[name] = properties[name];
          part.is_const = c[4];
          part.add(this);
        }
      }
  }
  // load diagram from JSON representation
  Schematic.prototype.load_schematic = function (value, initial_value) {
    // use default value if no schematic info in value
    if (value == undefined || value.indexOf('[') == -1)
      value = initial_value;
    if (value && value.indexOf('[') != -1) {

      // convert string value into data structure
      var json = JSON.parse(value);

      // top level is a list of components
      for (var i = json.length - 1; i >= 0; --i) {
        var c = json[i];
        if (c[0] == 'view') {
          this.ac_fstart = c[5];
          this.ac_fstop = c[6];
          this.ac_source_name = c[7];
          this.tran_npts = c[8];
          this.tran_tstop = c[9];
          this.dc_max_iters = c[10];
        } else if (c[0] == 'w') {
          // wire
          this.add_wire(c[1][0], c[1][1], c[1][2], c[1][3]);
        } else if (c[0] == 'dc') {
          this.dc_results = c[1];
        } else if (c[0] == 'transient') {
          this.transient_results = c[1];
        } else if (c[0] == 'ac') {
          this.ac_results = c[1];
        } else {
          // ordinary component
          //  c := [type, coords, properties, connections]
          var type = c[0];
          var coords = c[1];
          var properties = c[2];
          //console.log(c);
          if (c.length < 5)
            c.push(true);
          var part = new parts_map[type][0](coords[0], coords[1], coords[2]);
          for (var name in properties)
            part.properties[name] = properties[name];
          part.is_const = c[4];
          part.add(this);
        }
      }
    }
    else {
      this.ac_npts = '50'; // default values for AC Analysis
      this.ac_fstart = '10';
      this.ac_fstop = '1G';
      this.ac_source_name = undefined;
      this.dc_max_iters = '1000';  // default values dc solution
      this.tran_npts = '100';  // default values for transient analysis
      this.tran_tstop = '0.01';
      this.components = [];
      this.connection_points = [];
      this.clean_up_wires();

      //this.update_schematic1(this.input);

    }

    this.redraw_background();
  }

  // label all the nodes in the circuit
  Schematic.prototype.label_connection_points = function () {
    // start by clearing all the connection point labels
    for (var i = this.components.length - 1; i >= 0; --i)
      this.components[i].clear_labels();

    // components are in charge of labeling their unlabeled connections.
    // labels given to connection points will propagate to coincident connection
    // points and across Wires.

    // let special components like GND label their connection(s)
    for (var i = this.components.length - 1; i >= 0; --i)
      this.components[i].add_default_labels();

    // now have components generate labels for unlabeled connections
    this.next_label = 0;
    for (var i = this.components.length - 1; i >= 0; --i)
      this.components[i].label_connections();
  }

  Schematic.prototype.get_next_label = function () {
    // generate next label in sequence
    this.next_label += 1;
    return this.next_label.toString();
  }

  // propagate label to coincident connection points
  Schematic.prototype.propagate_label = function (label, location) {
    var cplist = this.connection_points[location];
    for (var i = cplist.length - 1; i >= 0; --i)
      cplist[i].propagate_label(label);
  }

  // update the value field of our corresponding input field with JSON
  // representation of schematic
  Schematic.prototype.update_value = function () {
    // label connection points
    this.label_connection_points();

    // build JSON data structure, convert to string value for
    // input field
    this.input.value = JSON.stringify(this.json_with_analyses());
  }

  Schematic.prototype.json = function () {
    var json = [];

    // output all the components/wires in the diagram
    var n = this.components.length;
    for (var i = 0; i < n; i++)
      json.push(this.components[i].json(i));

    // capture the current view parameters
    json.push(['view', this.origin_x, this.origin_y, this.scale,
      this.ac_npts, this.ac_fstart, this.ac_fstop,
      this.ac_source_name, this.tran_npts, this.tran_tstop,
      this.dc_max_iters]);

    return json;
  }

  Schematic.prototype.json_with_analyses = function () {
    var json = this.json();

    if (this.dc_results != undefined) json.push(['dc', this.dc_results]);
    if (this.ac_results != undefined) json.push(['ac', this.ac_results]);
    if (this.transient_results != undefined) json.push(['transient', this.transient_results]);

    return json;
  }

  ///////////////////////////////////////////////////////////////////////////////
  //
  //  Simulation interface
  //
  ////////////////////////////////////////////////////////////////////////////////

  Schematic.prototype.save_netlist = function () {
    // give circuit nodes a name, download netlist to client
    this.label_connection_points();
    var netlist = this.json();
    this.input.value = JSON.stringify(netlist);

    download(this.input.value, "ckt.txt", "text/plain");

    // Also save data to the browser's local store
    localStorage.setItem("ckt", this.input.value);
    console.log("wrote ckt to localStorage = " + localStorage.getItem("ckt"));

  }

  /*Schematic.prototype.share_link = function() {
     // give circuit nodes a name, create and display sharable link
     this.label_connection_points();
     var netlist = this.json();
     this.input.value = JSON.stringify(netlist);

     // dialog box with sharable link
     var link_lbl = 'Link';

     var fields = [];
     fields[link_lbl] = build_input('text',60,strSimulator + '?value=' + this.input.value);

     var content = build_table(fields);
     content.fields = fields;
     content.sch = this;

     this.dialog(i18n.Sharable_Link,content,function(content) {
     return null;
     });

     console.log("sharable link: " + strSimulator + '?value=' + this.input.value);
     }*/

  /*	Schematic.prototype.open_netlist = function() {
     this.unselect_all(-1);
     this.redraw_background();

     if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|BB|PlayBook|IEMobile|Windows Phone|Kindle|Silk|Opera Mini/i.test(navigator.userAgent)) {
     // Any mobile platform: load stored ctk from browser's localStorage
     if (window.confirm('Open a netlist?')){
     var imported_netlist = localStorage.getItem("ckt");

     this.components = [];
     this.connection_points = [];
     this.load_schematic(imported_netlist);
     this.zoomall();

     console.log( "ckt from localStorage = " + imported_netlist);
     }
     } else {
     // Desktop: load ckt from client's file system
     var file_lbl = 'Select_netlist';

     var fields = [];
     fields[file_lbl] = build_input('file',10,'');

     var content = build_table(fields);
     content.fields = fields;
     content.sch = this;

     this.dialog(i18n.Open_netlist,content,function(content) {
     var sch = content.sch;

     // retrieve parameters, remember for next time
     var files = content.fields[file_lbl].files;
     console.log(files);

     // files is a FileList of File objects. List some properties.
     if (files.length > 0) {
     var file = files[0];
     var reader = new FileReader();

     // print out the result when the file is finished loading
     reader.onload = function(e) {
     var imported_netlist = e.target.result;

     content.sch.components = [];
     content.sch.connection_points = [];
     content.sch.load_schematic(imported_netlist);
     content.sch.zoomall();

     console.log(e.target.result);
     };

     // start reading the file
     reader.readAsText(file);
     }
     });
     }
     }
     */
  Schematic.prototype.extract_circuit = function () {
    // give all the circuit nodes a name, extract netlist
    this.label_connection_points();
    var netlist = this.json();

    // since we've done the heavy lifting, update input field value
    // so user can grab diagram if they want
    this.input.value = JSON.stringify(netlist);

    // create a circuit from the netlist
    var ckt = new cktsim.Circuit();
    if (ckt.load_netlist(netlist))
      return ckt;
    else
      return null;
  }

  Schematic.prototype.dc_analysis = function () {
    // remove any previous annotations
    this.unselect_all(-1);
    this.redraw_background();

    var ckt = this.extract_circuit();

    if (ckt === null) return;

    // run the analysis
    this.operating_point = ckt.dc();
    console.log(this.operating_point);

    if (this.operating_point != undefined) {
      // save a copy of the results for submission
      this.dc_results = {};
      for (var i in this.operating_point) this.dc_results[i] = this.operating_point[i];

      // display results on diagram
     // this.redraw();
    }
  }

  // return a list of [color,node_label,offset,type] for each probe in the diagram
  // type == 'voltage' or 'current'
  Schematic.prototype.find_probes = function () {
    var result = [];
    var result = [];
    for (var i = this.components.length - 1; i >= 0; --i) {
      var c = this.components[i];
      var info = c.probe_info();
      if (info != undefined) result.push(c.probe_info());
    }
    return result;
  }

  // use a dialog to get AC analysis parameters
  Schematic.prototype.setup_ac_analysis = function () {
    this.unselect_all(-1);
    this.redraw_background();

    var npts_lbl = 'points_per_decade';	//'Number of points per decade';	//not used
    var fstart_lbl = 'Starting_frequency';
    var fstop_lbl = 'Ending_frequency';
    var source_name_lbl = 'source_for_ac';		//'Name of V or I source for ac';

    if (this.find_probes().length == 0) {
      //alert("AC Analysis: add a voltage probe to the diagram!");
      alert(i18n.AC_Analysis_add_a_voltage_probe);
      return;
    }

    var fields = [];
    fields[fstart_lbl] = build_input('text', 10, this.ac_fstart);
    fields[fstop_lbl] = build_input('text', 10, this.ac_fstop);
    fields[source_name_lbl] = build_input('text', 10, this.ac_source_name);

    var content = build_table(fields);
    content.fields = fields;
    content.sch = this;

    this.dialog(i18n.AC_Analysis, content, function (content) {
      var sch = content.sch;

      // retrieve parameters, remember for next time
      sch.ac_fstart = content.fields[fstart_lbl].value;
      sch.ac_fstop = content.fields[fstop_lbl].value;
      sch.ac_source_name = content.fields[source_name_lbl].value;

      sch.ac_analysis(cktsim.parse_number(sch.ac_npts),
        cktsim.parse_number(sch.ac_fstart),
        cktsim.parse_number(sch.ac_fstop),
        sch.ac_source_name);
    });
  }

  Schematic.prototype.ac_analysis = function (npts, fstart, fstop, ac_source_name) {
    var ckt = this.extract_circuit();
    if (ckt === null) return;
    var results = ckt.ac(npts, fstart, fstop, ac_source_name);

    if (typeof results == 'string')
      this.message(results);
    else {
      var x_values = results['_frequencies_'];

      // x axis will be a log scale
      for (var i = x_values.length - 1; i >= 0; --i)
        x_values[i] = Math.log(x_values[i]) / Math.LN10;

      if (this.submit_analyses != undefined) {
        var submit = this.submit_analyses['ac'];
        if (submit != undefined) {
          // save a copy of the results for submission
          this.ac_results = {};

          // save requested values for each requested node
          for (var j = 0; j < submit.length; j++) {
            var flist = submit[j];    // [node_name,f1,f2,...]
            var node = flist[0];
            var values = results[node];
            var fvlist = [];
            // for each requested freq, interpolate response value
            for (var k = 1; k < flist.length; k++) {
              var f = flist[k];
              var v = interpolate(f, x_values, values);
              // convert to dB
              fvlist.push([f, v == undefined ? 'undefined' : 20.0 * Math.log(v) / Math.LN10]);
            }
            // save results as list of [f,response] paris
            this.ac_results[node] = fvlist;
          }
        }
      }

      // set up plot values for each node with a probe
      var y_values = [];  // list of [color, result_array]
      var z_values = [];  // list of [color, result_array]
      var probes = this.find_probes();
      var probe_maxv = [];
      var probe_color = [];

      // Check for probe with near zero transfer function and warn
      for (var i = probes.length - 1; i >= 0; --i) {
        if (probes[i][3] != 'voltage') continue;
        probe_color[i] = probes[i][0];
        var label = probes[i][1];
        var v = results[label];
        probe_maxv[i] = array_max(v); // magnitudes always > 0
      }

      var all_max = array_max(probe_maxv);
      if (all_max < 1.0e-16) {
        //alert('Zero ac response, -infinity on DB scale.');
        alert(i18n.Zero_ac_response);
      } else {
        for (var i = probes.length - 1; i >= 0; --i) {
          if (probes[i][3] != 'voltage') continue;
          if ((probe_maxv[i] / all_max) < 1.0e-10) {
            //alert('Near zero ac response, remove ' + probe_color[i] + ' probe');
            alert(i18n.Near_zero_ac_response + probe_color[i] + i18n.probe);
            return;
          }
        }
      }

      for (var i = probes.length - 1; i >= 0; --i) {
        if (probes[i][3] != 'voltage') continue;
        var color = probes[i][0];
        var label = probes[i][1];
        var offset = cktsim.parse_number(probes[i][2]);
        var v = results[label];
        // convert values into dB relative to source amplitude
        var v_max = 1;
        for (var j = v.length - 1; j >= 0; --j)
          // convert each value to dB relative to max
          v[j] = 20.0 * Math.log(v[j] / v_max) / Math.LN10;
        y_values.push([color, offset, v]);

        var v = results[label + '_phase'];
        z_values.push([color, 0, v]);
      }

      // graph the result and display in a window
      var graph2 = this.graph(x_values, i18n.log_Frequency, z_values, i18n.degrees);
      this.window(i18n.AC_Phase, graph2);
      var graph1 = this.graph(x_values, i18n.log_Frequency, y_values, 'dB');
      this.window(i18n.AC_Magnitude, graph1, 50);
    }
  }

  Schematic.prototype.transient_analysis = function () {
    this.unselect_all(-1);
    this.redraw_background();

    var npts_lbl = 'Minimum_number_of_timepoints';	//not used
    var tstop_lbl = 'Stop_time_seconds';
    var probes = this.find_probes();
    if (probes.length == 0) {
      alert(i18n.Transient_Analysis_add_a_probe);
      return;
    }

    var fields = [];
    fields[tstop_lbl] = build_input('text', 10, this.tran_tstop);

    var content = build_table(fields);
    content.fields = fields;
    content.sch = this;

    this.dialog(i18n.Transient_Analysis, content, function (content) {
      var sch = content.sch;
      var ckt = sch.extract_circuit();
      if (ckt === null) return;

      // retrieve parameters, remember for next time
      sch.tran_tstop = content.fields[tstop_lbl].value;

      // gather a list of nodes that are being probed.  These
      // will be added to the list of nodes checked during the
      // LTE calculations in transient analysis
      var probe_list = sch.find_probes();
      var probe_names = new Array(probe_list.length);
      for (var i = probe_list.length - 1; i >= 0; --i)
        probe_names[i] = probe_list[i][1];

      // run the analysis
      var results = ckt.tran(ckt.parse_number(sch.tran_npts), 0,
        ckt.parse_number(sch.tran_tstop), probe_names, false);

      if (typeof results == 'string')
        sch.message(results);
      else {
        if (sch.submit_analyses != undefined) {
          var submit = sch.submit_analyses['tran'];
          if (submit != undefined) {
            // save a copy of the results for submission
            sch.transient_results = {};
            var times = results['_time_'];

            // save requested values for each requested node
            for (var j = 0; j < submit.length; j++) {
              var tlist = submit[j];    // [node_name,t1,t2,...]
              var node = tlist[0];
              var values = results[node];
              var tvlist = [];
              // for each requested time, interpolate waveform value
              for (var k = 1; k < tlist.length; k++) {
                var t = tlist[k];
                var v = interpolate(t, times, values);
                tvlist.push([t, v == undefined ? 'undefined' : v]);
              }
              // save results as list of [t,value] pairs
              sch.transient_results[node] = tvlist;
            }
          }
        }

        var x_values = results['_time_'];
        var x_legend = i18n.Time;

        // set up plot values for each node with a probe
        var v_values = [];  // voltage values: list of [color, result_array]
        var i_values = [];  // current values: list of [color, result_array]
        var probes = sch.find_probes();

        for (var i = probes.length - 1; i >= 0; --i) {
          var color = probes[i][0];
          var label = probes[i][1];
          var offset = cktsim.parse_number(probes[i][2]);
          var v = results[label];
          if (v == undefined) {
            alert(i18n.The + color + i18n.probe_is_connected_to_node + '"' + label + '"' + i18n.which_is_not_an_actual_circuit_node);
          } else if (probes[i][3] == 'voltage') {
            if (color == 'xaxis') {
              x_values = v;
              x_legend = i18n.Voltage;
            } else v_values.push([color, offset, v]);
          } else {
            if (color == 'xaxis') {
              x_values = v;
              x_legend = i18n.Current;
            } else i_values.push([color, offset, v]);
          }
        }

        // graph the result and display in a window
        var graph = sch.graph(x_values, x_legend, v_values, i18n.Voltage, i_values, i18n.Current);
        sch.window(i18n.Transient_Analysis, graph);
      }
    })
  }

  // t is the time at which we want a value
  // times is a list of timepoints from the simulation
  function interpolate(t, times, values) {
    if (values == undefined) return undefined;

    for (var i = 0; i < times.length; i++)
      if (t < times[i]) {
        // t falls between times[i-1] and times[i]
        var t1 = (i == 0) ? times[0] : times[i - 1];
        var t2 = times[i];

        if (t2 == undefined) return undefined;

        var v1 = (i == 0) ? values[0] : values[i - 1];
        var v2 = values[i];
        var v = v1;
        if (t != t1) v += (t - t1) * (v2 - v1) / (t2 - t1);
        return v;
      }
  }

  // external interface for setting the property value of a named component
  Schematic.prototype.set_property = function (component_name, property, value) {
    this.unselect_all(-1);

    for (var i = this.components.length - 1; i >= 0; --i) {
      var component = this.components[i];
      if (component.properties['name'] == component_name) {
        component.properties[property] = value.toString();
        break;
      }
    }

    this.redraw_background();
  }

  ///////////////////////////////////////////////////////////////////////////////
  //
  //  Drawing support -- deals with scaling and scrolling of diagrama
  //
  ////////////////////////////////////////////////////////////////////////////////

  // here to redraw background image containing static portions of the schematic.
  // Also redraws dynamic portion.
  Schematic.prototype.redraw_background = function () {
    var c = this.bg_image.getContext('2d');
    //c.scale(2,2);	//retina display - doesn't look good

    c.lineCap = 'butt';	// butt(D) | *round | square

    // paint background color
    c.fillStyle = element_style;
    c.fillRect(0, 0, this.width, this.height);

    if (!this.diagram_only && this.show_grid) {
      // grid
      c.strokeStyle = grid_style;
      var first_x = this.origin_x;
      var last_x = first_x + this.width / this.scale;
      var first_y = this.origin_y;
      var last_y = first_y + this.height / this.scale;

      for (var i = this.grid * Math.ceil(first_x / this.grid); i < last_x; i += this.grid)
        this.draw_line(c, i, first_y, i, last_y, 1);

      for (var i = this.grid * Math.ceil(first_y / this.grid); i < last_y; i += this.grid)
        this.draw_line(c, first_x, i, last_x, i, 1);
    }

    // unselected components
    var min_x = Infinity;  // compute bounding box for diagram
    var max_x = -Infinity;
    var min_y = Infinity;
    var max_y = -Infinity;
    for (var i = this.components.length - 1; i >= 0; --i) {
      var component = this.components[i];
      if (!component.selected) {
        component.draw(c);
        min_x = Math.min(component.bbox[0], min_x);
        max_x = Math.max(component.bbox[2], max_x);
        min_y = Math.min(component.bbox[1], min_y);
        max_y = Math.max(component.bbox[3], max_y);
      }
    }
    this.unsel_bbox = [min_x, min_y, max_x, max_y];
    this.redraw();   // background changed, redraw on screen
  }

  // redraw what user sees = static image + dynamic parts
  Schematic.prototype.redraw = function () {
    var c = this.canvas.getContext('2d');

    // put static image in the background
    c.drawImage(this.bg_image, 0, 0);

    // selected components
    var min_x = this.unsel_bbox[0];   // compute bounding box for diagram
    var max_x = this.unsel_bbox[2];
    var min_y = this.unsel_bbox[1];
    var max_y = this.unsel_bbox[3];
    var selections = false;
    for (var i = this.components.length - 1; i >= 0; --i) {
      var component = this.components[i];
      if (component.selected) {
        component.draw(c);
        selections = true;
        min_x = Math.min(component.bbox[0], min_x);
        max_x = Math.max(component.bbox[2], max_x);
        min_y = Math.min(component.bbox[1], min_y);
        max_y = Math.max(component.bbox[3], max_y);
      }
    }
    if (min_x == Infinity) this.bbox = [0, 0, 0, 0];
    else this.bbox = [min_x, min_y, max_x, max_y];
    this.enable_tool('cut', selections);
    this.enable_tool('copy', selections);
    this.enable_tool('paste', sch_clipboard.length > 0);
    this.enable_tool('delete', selections);
    this.enable_tool('rotate', selections);

    // connection points: draw one at each location
    for (var location in this.connection_points) {
      var cplist = this.connection_points[location];
      cplist[0].draw(c, cplist.length);
    }

    // draw new wire
    if (this.wire) {
      var r = this.wire;
      c.strokeStyle = selected_style;
      this.draw_line(c, r[0], r[1], r[2], r[3], 1);
    }

    // draw selection rectangle
    if (this.select_rect) {
      var r = this.select_rect;
      c.lineWidth = 1;
      c.strokeStyle = selected_style;
      c.beginPath();
      c.moveTo(r[0], r[1]);
      c.lineTo(r[0], r[3]);
      c.lineTo(r[2], r[3]);
      c.lineTo(r[2], r[1]);
      c.lineTo(r[0], r[1]);
      c.stroke();
    }

    // display operating point results
    if (this.operating_point) {
      if (typeof this.operating_point == 'string')
        this.message(this.operating_point);
      else {
        // make a copy of the operating_point info so we can mess with it
        var temp = [];
        for (var i in this.operating_point) temp[i] = this.operating_point[i];

        // run through connection points displaying (once) the voltage
        // for each electrical node
        for (var location in this.connection_points)
          (this.connection_points[location])[0].display_voltage(c, temp);

        // let components display branch current info if available
        for (var i = this.components.length - 1; i >= 0; --i)
          this.components[i].display_current(c, temp)
      }
    }

    // scroll/zoom/rotate/delete controls
    if (!this.diagram_only) {
      var o = 0.5;		// half pixel offset for sharp lines with odd pixel width
      var r = this.sctl_r;
      var x = this.sctl_x + o;
      var y = this.sctl_y + o;

      // filled circle with border
      c.fillStyle = element_style;
      c.beginPath();
      c.arc(x, y, r, 0, 2 * Math.PI);
      c.fill();

      c.strokeStyle = stroke_style;
      c.lineWidth = 0.5;
      c.beginPath();
      c.arc(x, y, r, 0, 2 * Math.PI);
      c.stroke();

      // direction markers for scroll
      c.lineWidth = 2;
      c.beginPath();

      c.moveTo(x + 4, y - r + 8);   // north
      c.lineTo(x, y - r + 4);
      c.lineTo(x - 4, y - r + 8);

      c.moveTo(x + r - 8, y + 4);   // east
      c.lineTo(x + r - 4, y);
      c.lineTo(x + r - 8, y - 4);

      c.moveTo(x + 4, y + r - 8);   // south
      c.lineTo(x, y + r - 4);
      c.lineTo(x - 4, y + r - 8);

      c.moveTo(x - r + 8, y + 4);   // west
      c.lineTo(x - r + 4, y);
      c.lineTo(x - r + 8, y - 4);

      c.stroke();

      // zoom control
      x = this.zctl_x;
      y = this.zctl_y;
      var w = this.zctl_w;
      var h = this.zctl_h;
      var s = 6;			// 1/2 horiz stroke length
      var t = 12;			//     vert symbol spacing
      c.lineWidth = 0.5;
      c.fillStyle = element_style;    // background
      c.fillRect(x - w / 2 + o, y + o, w, h);
      c.strokeStyle = stroke_style;     // border
      c.strokeRect(x - w / 2 + o, y + o, w, h);
      c.lineWidth = 1;
      c.beginPath();
      // zoom in plus
      c.moveTo(x - s, y + t + o);
      c.lineTo(x + s + 1, y + t + o);
      c.moveTo(x + o, y + t - s);
      c.lineTo(x + o, y + t + s + 1);
      // zoom out minus
      c.moveTo(x - s, y + 3 * t + o);
      c.lineTo(x + s + 1, y + 3 * t + o);
      // zoom all box
      c.strokeRect(x - s + o, y + 4 * t + t / 2 + o, 2 * s, 2 * s);
      c.stroke();

      // rotate control
      /*r = this.rctl_r;
             x = this.rctl_x+o;
             y = this.rctl_y+o;

             // filled circle with border
             c.fillStyle = element_style;
             c.beginPath();
             c.arc(x,y,r,0,2*Math.PI);
             c.fill();

             c.strokeStyle = stroke_style;
             c.lineWidth = 0.5;
             c.beginPath();
             c.arc(x,y,r,0,2*Math.PI);
             c.stroke();

             c.lineWidth = 2;				//curved arrow
             r = this.sctl_r - 6;
             c.fillStyle = stroke_style;
             c.beginPath();
             c.arc(x,y,r,-0.6*Math.PI,0);	// 1/4 circle
             c.stroke();
             c.lineWidth = 1;
             c.beginPath();   				// arrowhead
             c.moveTo(x + 6,y);
             c.lineTo(x + 10,y + 4);
             c.lineTo(x + 14,y);
             c.lineTo(x + 6,y);
             c.fill();
             c.stroke();
             //c.font = "13pt sans-serif";
             //c.fillText("R",x - 8, y + 8);	// Why does this R jump around during rotate?

             c.lineWidth = 2;	// drawn R character
             c.beginPath();		// 1/2 circle
             c.arc(x-1,y,4,-0.5*Math.PI,+0.5*Math.PI);
             c.stroke();
             c.moveTo(x-6+o, y+10);
             c.lineTo(x-6+o, y-4);
             c.stroke();
             c.moveTo(x-6+o, y-4);
             c.lineTo(x, y-4);
             c.stroke();
             c.moveTo(x-6+o, y+4);
             c.lineTo(x, y+4);
             c.stroke();
             c.moveTo(x,y+4);
             c.lineTo(x+4,y+10+o);
             c.stroke();
             */
      // delete control
      /* r = this.dctl_r;
             x = this.dctl_x+o;
             y = this.dctl_y+o;

             // filled circle with border
             c.fillStyle = element_style;
             c.beginPath();
             c.arc(x,y,r,0,2*Math.PI);
             c.fill();

             c.strokeStyle = stroke_style;
             c.lineWidth = 0.5;
             c.beginPath();
             c.arc(x,y,r,0,2*Math.PI);
             c.stroke();

             c.lineWidth = 5;	// big X
             c.lineCap = 'round';
             c.beginPath();
             c.moveTo(x - 5,y - 5);
             c.lineTo(x + 5,y + 5);
             c.moveTo(x + 5,y - 5);
             c.lineTo(x - 5,y + 5);
             c.stroke();*/
    }
  }

  // draws a cross cursor
  Schematic.prototype.cross_cursor = function (c, x, y) {
    this.draw_line(c, x - this.grid, y, x + this.grid, y, 1);
    this.draw_line(c, x, y - this.grid, x, y + this.grid, 1);
  }

  Schematic.prototype.moveTo = function (c, x, y) {
    c.moveTo((x - this.origin_x) * this.scale, (y - this.origin_y) * this.scale);
  }

  Schematic.prototype.lineTo = function (c, x, y) {
    c.lineTo((x - this.origin_x) * this.scale, (y - this.origin_y) * this.scale);
  }

  Schematic.prototype.draw_line = function (c, x1, y1, x2, y2, width) {
    c.lineWidth = width * this.scale;
    c.beginPath();
    c.moveTo((x1 - this.origin_x) * this.scale, (y1 - this.origin_y) * this.scale);
    c.lineTo((x2 - this.origin_x) * this.scale, (y2 - this.origin_y) * this.scale);
    c.stroke();
  }

  Schematic.prototype.draw_arc = function (c, x, y, radius, start_radians, end_radians, anticlockwise, width, filled) {
    c.lineWidth = width * this.scale;
    c.beginPath();
    c.arc((x - this.origin_x) * this.scale, (y - this.origin_y) * this.scale, radius * this.scale,
      start_radians, end_radians, anticlockwise);
    if (filled) c.fill();
    else c.stroke();
  }

  Schematic.prototype.draw_text = function (c, text, x, y, size) {

    c.font = size * this.scale + 'pt sans-serif'
    c.fillText(text, (x - this.origin_x) * this.scale, (y - this.origin_y) * this.scale);
  }

  // add method to canvas to compute relative coords for event
  try {
    if (HTMLCanvasElement)
      HTMLCanvasElement.prototype.relMouseCoords = function (event) {
        // run up the DOM tree to figure out coords for top,left of canvas
        var totalOffsetX = 0;
        var totalOffsetY = 0;
        var currentElement = this;
        do {
          totalOffsetX += currentElement.offsetLeft;
          totalOffsetY += currentElement.offsetTop;
        }
        while (currentElement = currentElement.offsetParent);

        // now compute relative position of click within the canvas
        this.mouse_x = event.pageX - totalOffsetX;
        this.mouse_y = event.pageY - totalOffsetY;
        this.page_x = event.pageX;
        this.page_y = event.pageY;
      }
  }
  catch (err) { // ignore
  }

  ///////////////////////////////////////////////////////////////////////////////
  //
  //  Event handling
  //
  ////////////////////////////////////////////////////////////////////////////////

  // process keystrokes, consuming those that are meaningful to us
  function schematic_key_down(event) {
    if (!event) event = window.event;
    var sch = event.target.schematic;
    var code = event.keyCode;

    // keep track of modifier key state
    if (code == 16) sch.shiftKey = true;
    else if (code == 17) sch.ctrlKey = true;
    else if (code == 18) sch.altKey = true;
    else if (code == 91) sch.cmdKey = true;

    // backspace or delete: delete selected components
    else if (code == 8 || code == 46) {
      // delete selected components
      for (var i = sch.components.length - 1; i >= 0; --i) {
        var component = sch.components[i];
        if (component.selected) component.remove();
      }
      sch.clean_up_wires();
      sch.redraw_background();
      event.preventDefault();
      return false;
    }

    // cmd/ctrl x: cut
    else if ((sch.ctrlKey || sch.cmdKey) && code == 88) {
      sch.cut();
      event.preventDefault();
      return false;
    }

    // cmd/ctrl c: copy
    else if ((sch.ctrlKey || sch.cmdKey) && code == 67) {
      sch.copy();
      event.preventDefault();
      return false;
    }

    // cmd/ctrl v: paste
    else if ((sch.ctrlKey || sch.cmdKey) && code == 86) {
      sch.paste();
      event.preventDefault();
      return false;
    }

    // 'r': rotate component
    else if (!sch.ctrlKey && !sch.altKey && !sch.cmdKey && code == 82) {
      sch.rotate_selected();
      event.preventDefault();
      return false;
    }

    else return true;

    // consume keystroke
    sch.redraw();
    event.preventDefault();
    return false;
  }

  function schematic_key_up(event) {
    if (!event) event = window.event;
    var sch = event.target.schematic;
    var code = event.keyCode;

    if (code == 16) sch.shiftKey = false;
    else if (code == 17) sch.ctrlKey = false;
    else if (code == 18) sch.altKey = false;
    else if (code == 91) sch.cmdKey = false;
  }

  function schematic_mouse_enter(event) {
    if (!event) event = window.event;
    var sch = event.target.schematic;

    // see if user has selected a new part
    if (sch.new_part) {
      // grab incoming part, turn off selection of parts bin
      var part = sch.new_part;
      sch.new_part = undefined;
      part.select(false);

      // unselect everything else in the schematic, add part and select it
      sch.unselect_all(-1);
      sch.redraw_background();  // so we see any components that got unselected

      // make a clone of the component in the parts bin
      part = part.component.clone(sch.cursor_x, sch.cursor_y);
      part.add(sch);  // add it to schematic
      part.set_select(true);

      // and start dragging it
      sch.drag_begin();
    }

    sch.drawCursor = true;
    sch.redraw();
    sch.canvas.focus();  // capture key strokes
    return false;
  }

  function schematic_mouse_leave(event) {
    if (!event) event = window.event;
    var sch = event.target.schematic;
    sch.drawCursor = false;
    sch.redraw();
    return false;
  }

  function schematic_mouse_down(sch) {
    var mx = sch.canvas.mouse_x;
    var my = sch.canvas.mouse_y;
    var sx = mx - sch.sctl_x;
    var sy = my - sch.sctl_y;
    var zx = mx - sch.zctl_x;
    var zy = my - sch.zctl_y;
    /*var rx = mx - sch.rctl_x;
         var ry = my - sch.rctl_y;
         var dx = mx - sch.dctl_x;
         var dy = my - sch.dctl_y;*/
    var zw = sch.zctl_w;
    var zh = sch.zctl_h;

    if (sx * sx + sy * sy <= sch.sctl_r * sch.sctl_r) {   // clicked in scrolling control
      // check which quadrant
      if (Math.abs(sy) > Math.abs(sx)) {  // N or S
        var delta = sch.height / 8;
        if (sy > 0) delta = -delta;
        var temp = sch.origin_y - delta;
        if (temp > origin_min * sch.grid && temp < origin_max * sch.grid) sch.origin_y = temp;
      } else {			    			// E or W
        var delta = sch.width / 8;
        if (sx < 0) delta = -delta;
        var temp = sch.origin_x + delta;
        if (temp > origin_min * sch.grid && temp < origin_max * sch.grid) sch.origin_x = temp;
      }
    } else if (zx >= -zw / 2 && zx < zw / 2 && zy >= 0 && zy < zh) {   // clicked in zoom control
      if (zy < zh / 3) sch.zoomin();
      else if (zy < 2 * zh / 3) sch.zoomout();
      else sch.zoomall();
    }/*
         else if (rx*rx + ry*ry <= sch.rctl_r*sch.rctl_r) {   // clicked in rotation control
         sch.rotate_selected();
         event.preventDefault();
         return false;
         }
         else if (dx*dx + dy*dy <= sch.rctl_r*sch.rctl_r) {   // clicked in delete control
         sch.delete_selected();
         event.preventDefault();
         return false;
         } */ else {											//clicked in schematic area
      var x = mx / sch.scale + sch.origin_x;
      var y = my / sch.scale + sch.origin_y;
      sch.cursor_x = Math.round(x / sch.grid) * sch.grid;
      sch.cursor_y = Math.round(y / sch.grid) * sch.grid;
      if (sch.is_question) {
        var which = -1;
        for (var i = sch.components.length - 1; i >= 0; --i)
          if (sch.components[i].select(x, y, false)) {
            if (sch.components[i].selected) {
              is_question_mouse_down(sch.components[i]);
              ///TODO a tooltip to display the element name

              which = i;  // keep track of component we found

            }
            break;
          }
        sch.unselect_all(which);
      }
      else {
        // is mouse over a connection point?  If so, start dragging a wire
        var cplist = sch.connection_points[sch.cursor_x + ',' + sch.cursor_y];
        if (cplist && !event.shiftKey) {
          //sch.unselect_all(-1);		//commented out for touch
          //With touch, we can't drag a new part onto the schematic (there isn't a "touch_enter" event).
          //So we do a "tap-tap" sequence to add parts.
          //Parts are selected from the bin and added to the component list (add_part).
          //The next tap inside the schematic area places the new part.
          //If we uncomment the unselect_all above, it would unselect the pending new component and it does not get placed.
          //Side effect: Commenting out unselect_all above leaves any currently selected parts still selected.
          sch.wire = [sch.cursor_x, sch.cursor_y, sch.cursor_x, sch.cursor_y];
        } else {
          // give all components a shot at processing the selection event
          var which = -1;
          for (var i = sch.components.length - 1; i >= 0; --i)
            if (sch.components[i].select(x, y, event.shiftKey)) {
              if (sch.components[i].selected) {
                // console.log(sch.components[i]);
                //console.log("nothng");
                ///TODO here we can get the selected item
                sch.on_click_component(sch.components[i]);
                sch.drag_begin();
                which = i;  // keep track of component we found
              }
              break;
            }
          // did we just click on a previously selected component?
          var reselect = which != -1 && sch.components[which].was_previously_selected;

          if (!event.shiftKey) {
            // if shift key isn't pressed and we didn't click on component
            // that was already selected, unselect everyone except component
            // we just clicked on
            if (!reselect) sch.unselect_all(which);

            // if there's nothing to drag, set up a selection rectangle
            if (!sch.dragging) sch.select_rect = [sch.canvas.mouse_x, sch.canvas.mouse_y,
              sch.canvas.mouse_x, sch.canvas.mouse_y];
          }
        }
      }

      if (sch.new_part) {
        // grab incoming part, turn off selection of parts bin
        var part = sch.new_part;
        sch.new_part = undefined;
        part.select(false);

        // unselect everything else in the schematic, add part and select it
        sch.unselect_all(-1);
        sch.redraw_background();  // so we see any components that got unselected

        // make a clone of the component in the parts bin
        part = part.component.clone(sch.cursor_x, sch.cursor_y);
        part.add(sch);  // add it to schematic
        part.set_select(true);

        // and start dragging it
        sch.drag_begin();
      }
    }
    sch.redraw_background();
    return false;
  }

  function schematic_mouse_move(sch) {
    var x = sch.canvas.mouse_x / sch.scale + sch.origin_x;
    var y = sch.canvas.mouse_y / sch.scale + sch.origin_y;
    sch.cursor_x = Math.round(x / sch.grid) * sch.grid;
    sch.cursor_y = Math.round(y / sch.grid) * sch.grid;

    if (sch.wire) {
      // update new wire end point
      sch.wire[2] = sch.cursor_x;
      sch.wire[3] = sch.cursor_y;
    } else if (sch.dragging) {
      // see how far we moved
      var dx = sch.cursor_x - sch.drag_x;
      var dy = sch.cursor_y - sch.drag_y;
      if (dx != 0 || dy != 0) {
        // update position for next time
        sch.drag_x = sch.cursor_x;
        sch.drag_y = sch.cursor_y;

        // give all components a shot at processing the event
        for (var i = sch.components.length - 1; i >= 0; --i) {
          var component = sch.components[i];
          if (component.selected) component.move(dx, dy);
        }
      }
    } else if (sch.select_rect) {
      // update moving corner of selection rectangle
      sch.select_rect[2] = sch.canvas.mouse_x;
      sch.select_rect[3] = sch.canvas.mouse_y;
    }

    // just redraw dynamic components
    sch.redraw();

    return false;
  }

  function schematic_mouse_up(sch) {
    // drawing a new wire
    if (sch.is_question) {
      sch.unselect_all(-1);
      sch.select_rect = undefined;
      sch.redraw_background();

      return false;
    }
    if (sch.wire) {
      var r = sch.wire;
      sch.wire = undefined;

      if (r[0] != r[2] || r[1] != r[3]) {
        // insert wire component
        sch.add_wire(r[0], r[1], r[2], r[3]);
        sch.clean_up_wires();
        sch.redraw_background();
      } else sch.redraw();
    }

    // dragging
    if (sch.dragging) sch.drag_end();

    // selection rectangle
    if (sch.select_rect) {
      var r = sch.select_rect;

      // if select_rect is a point, we've already dealt with selection
      // in mouse_down handler
      if (r[0] != r[2] || r[1] != r[3]) {
        // convert to schematic coordinates
        var s = [r[0] / sch.scale + sch.origin_x, r[1] / sch.scale + sch.origin_y,
          r[2] / sch.scale + sch.origin_x, r[3] / sch.scale + sch.origin_y];
        canonicalize(s);

        if (!event.shiftKey) sch.unselect_all();

        // select components that intersect selection rectangle
        for (var i = sch.components.length - 1; i >= 0; --i)
          sch.components[i].select_rect(s, event.shiftKey);
      }

      sch.select_rect = undefined;
      sch.redraw_background();
    }
    return false;
  }

  /* Wheel zoom commented out for smart phone. Allows normal panning of a large schematic in a small window.
     function schematic_mouse_wheel(event) {
     if (!event) event = window.event;
     else event.preventDefault();
     var sch = event.target.schematic;

     var delta = 0;
     if (event.wheelDelta) delta = event.wheelDelta;
     else if (event.detail) delta = -event.detail;

     if (delta) {
     var nscale = (delta > 0) ? sch.scale*zoom_wheel_factor : sch.scale/zoom_wheel_factor;

     if (nscale > zoom_min && nscale < zoom_max) {
     // zoom around current mouse position
     sch.canvas.relMouseCoords(event);
     var s = 1.0/sch.scale - 1.0/nscale;
     sch.origin_x += sch.canvas.mouse_x*s;
     sch.origin_y += sch.canvas.mouse_y*s;
     sch.scale = nscale;
     sch.redraw_background();
     }
     }
     } */


  function schematic_double_click(event) {

    if (!event) event = window.event;
    else event.preventDefault();
    var sch = event.target.schematic;

    // determine where event happened in schematic coordinates
    sch.canvas.relMouseCoords(event);
    var x = sch.canvas.mouse_x / sch.scale + sch.origin_x;
    var y = sch.canvas.mouse_y / sch.scale + sch.origin_y;
    sch.cursor_x = Math.round(x / sch.grid) * sch.grid;
    sch.cursor_y = Math.round(y / sch.grid) * sch.grid;
    if (sch.is_static && !sch.allow_edits) {
      var which = -1;
      for (var i = sch.components.length - 1; i >= 0; --i)
        if (sch.components[i].select(x, y, false)) {
          if (sch.components[i].selected) {
            //is_question_double_click(sch.components[i]);
            console.log(sch);
           sch.on_double_click_component(sch.components[i].properties['name']);
            ///TODO a tooltip to display the element name
            which = i;  // keep track of component we found

          }
          break;
        }
      sch.unselect_all(which);
    }
    else {
      // see if we double-clicked a component.  If so, edit it's properties
      for (var i = sch.components.length - 1; i >= 0; --i)

        if (! sch.components[i].is_const &&   sch.components[i].edit_properties(x, y))
          break;
    }
    return false;

  }

  ///////////////////////////////////////////////////////////////////////////////
  //
  //  Status message and dialogs
  //
  ////////////////////////////////////////////////////////////////////////////////

  Schematic.prototype.message = function (message) {
      this.status.nodeValue = message;
  }

  Schematic.prototype.append_message = function (message) {
    this.status.nodeValue += ' / ' + message;
  }

  // set up a dialog with specified title, content and two buttons at
  // the bottom: OK and Cancel.  If Cancel is clicked, dialog goes away
  // and we're done.  If OK is clicked, dialog goes away and the
  // callback function is called with the content as an argument (so
  // that the values of any fields can be captured).
  Schematic.prototype.dialog = function (title, content, callback) {
    // create the div for the top level of the dialog, add to DOM
    var dialog = document.createElement('div');
    dialog.sch = this;
    dialog.content = content;
    dialog.callback = callback;

    // look for property input fields in the content and give
    // them a keypress listener that interprets ENTER as
    // clicking OK.
    var plist = content.getElementsByClassName('property');
    for (var i = plist.length - 1; i >= 0; --i) {
      var field = plist[i];
      field.dialog = dialog;  // help event handler find us...
      field.addEventListener('keypress', dialog_check_for_ENTER, false);
    }

    // div to hold the content
    var body = document.createElement('div');
    content.style.marginBotton = '5px';
    body.appendChild(content);
    body.style.padding = '5px';
    body.style.font = '10pt sans-serif';
    dialog.appendChild(body);

    var ok_button = document.createElement('span');
    var ok_icon = document.createElement("span");
    ok_icon.setAttribute('class', 'fa fa-fw fa-check fa-2x');
    ok_icon.style.color = ok_style;
    ok_icon.dialog = dialog;
    ok_button.appendChild(ok_icon);

    ok_button.dialog = dialog;   // for the handler to use
    ok_button.addEventListener('click', dialog_okay, false);
    ok_button.style.display = 'inline';
    ok_button.style.border = '0px solid';
    ok_button.style.padding = '5px';
    ok_button.style.margin = '10px';
    ok_button.style.font = '10pt sans-serif';

    var cancel_button = document.createElement('span');
    var cancel_icon = document.createElement("span");
    cancel_icon.setAttribute('class', 'fa fa-fw fa-times fa-2x');
    cancel_icon.style.color = cancel_style;
    cancel_icon.dialog = dialog;
    cancel_button.appendChild(cancel_icon);

    cancel_button.dialog = dialog;   // for the handler to use
    cancel_button.addEventListener('click', dialog_cancel, false);
    cancel_button.style.display = 'inline';
    cancel_button.style.border = '0px solid';
    cancel_button.style.padding = '5px';
    cancel_button.style.margin = '10px';
    cancel_button.style.font = '10pt sans-serif';

    // div to hold the two buttons
    var buttons = document.createElement('div');
    buttons.style.textAlign = 'center';
    buttons.appendChild(ok_button);
    buttons.appendChild(cancel_button);
    buttons.style.padding = '5px';
    buttons.style.margin = '10px';
    dialog.appendChild(buttons);

    // put into an overlay window
    this.window(title, dialog, 20);
  }

  function dialog_cancel(event) {
    if (!event) event = window.event;
    var dialog = event.target.dialog;

    window_close(dialog.win);
  }

  function dialog_okay(event) {
    if (!event) event = window.event;
    var dialog = event.target.dialog;

    window_close(dialog.win);

    if (dialog.callback) dialog.callback(dialog.content);
  }

  // callback for keypress in input fields: if user typed ENTER, act
  // like they clicked OK button.
  function dialog_check_for_ENTER(event) {
    var key = (window.event) ? window.event.keyCode : event.keyCode;
    if (key == 13) dialog_okay(event);
  }

  ///////////////////////////////////////////////////////////////////////////////
  //
  //  Draggable, resizeable, closeable window
  //
  ////////////////////////////////////////////////////////////////////////////////

  // build a 2-column HTML table from an associative array (keys as text in
  // column 1, values in column 2).
  function build_table(a) {
    var tbl = document.createElement('table');

    // build a row for each element in associative array
    for (var i in a) {
      var label = document.createTextNode(i18n[i] + ': ');	//row labels are translated here
      var col1 = document.createElement('td');
      col1.appendChild(label);
      var col2 = document.createElement('td');
      col2.appendChild(a[i]);
      var row = document.createElement('tr');
      row.appendChild(col1);
      row.appendChild(col2);
      row.style.verticalAlign = 'center';
      tbl.appendChild(row);
    }

    return tbl;
  }

  function build_input(type, size, value) {
    var input = document.createElement('input');
    input.type = type;
    input.size = size;
    input.className = 'property';  // make this easier to find later
    if (value == undefined) input.value = '';
    else input.value = value.toString();
    return input;
  }

  // build a select widget using the strings found in the options array
  function build_select(options, selected) {
    var select = document.createElement('select');
    for (var i = 0; i < options.length; i++) {
      var option = document.createElement('option');
      option.value = options[i];		//QQQ value is the English field name in a dropdown list (if omitted, defaults to option.text)
      option.text = i18n[options[i]];						//text in a dropdown list are translated here
      select.add(option);
      if (options[i] == selected) select.selectedIndex = i;
    }
    return select;
  }

  Schematic.prototype.window = build_window;

  function build_window(title, content, offset) {
    // create the div for the top level of the window
    var win = document.createElement('div');
    win.sch = this;
    win.content = content;
    win.drag_x = undefined;
    win.draw_y = undefined;

    // div to hold the title
    var head = document.createElement('div');
    head.style.backgroundColor = 'white'; //'rgb(202,51,124)';		// KA Science1
    head.style.font = '10pt sans-serif';
    head.style.color = 'black';
    head.style.fontWeight = 'bold';
    head.style.textAlign = 'center';
    head.style.padding = '5px';
    head.style.borderBottom = '1px solid';
    head.style.borderColor = border_style;
    head.style.borderRadius = '4px 4px 0px 0px';
    head.appendChild(document.createTextNode(title));
    head.win = win;
    win.head = head;

    var close_button = document.createElement("span");
    close_button.setAttribute('class', 'fa fa-fw fa-times fa-lg');
    close_button.style.color = cancel_style;
    //var close_button = new Image();
    //close_button.src = close_icon;
    close_button.style.cssFloat = 'right';
    close_button.addEventListener('click', window_close_button, false);
    close_button.win = win;
    head.appendChild(close_button);


    win.appendChild(head);

    // capture mouse events in title bar
    head.addEventListener('mousedown', window_mouse_down, false);

    // div to hold the content
    win.appendChild(content);
    content.win = win;   // so content can contact us

    // compute location relative to canvas
    if (offset == undefined) offset = 0;
    win.left = this.canvas.mouse_x + offset;
    win.top = this.canvas.mouse_y + offset;

    // add to DOM
    win.style.background = 'white';
    win.style.position = 'absolute';
    win.style.left = win.left + 'px';
    win.style.top = win.top + 'px';
    win.style.border = '1px solid';
    win.style.borderColor = border_style;
    win.style.borderRadius = '4px';


    this.canvas.parentNode.insertBefore(win, this.canvas);
    bring_to_front(win, true);
  }

  // adjust zIndex of pop-up window so that it is in front
  function bring_to_front(win, insert) {
    var wlist = win.sch.window_list;
    var i = wlist.indexOf(win);

    // remove from current position (if any) in window list
    if (i != -1) wlist.splice(i, 1);

    // if requested, add to end of window list
    if (insert) wlist.push(win);

    // adjust all zIndex values
    for (i = 0; i < wlist.length; i += 1)
      wlist[i].style.zIndex = 1000 + i;
  }

  // close the window
  function window_close(win) {
    // remove the window from the top-level div of the schematic
    win.parentNode.removeChild(win);

    // remove from list of pop-up windows
    bring_to_front(win, false);
  }

  function window_close_button(event) {
    if (!event) event = window.event;
    var src = event.target;
    window_close(src.win);
  }

  // capture mouse events in title bar of window
  function window_mouse_down(event) {
    if (!event) event = window.event;
    var src = event.target;
    var win = src.win;

    bring_to_front(win, true);

    // add handlers to document so we capture them no matter what
    document.addEventListener('mousemove', window_mouse_move, false);
    document.addEventListener('mouseup', window_mouse_up, false);
    document.tracking_window = win;

    // remember where mouse is so we can compute dx,dy during drag
    win.drag_x = event.pageX;
    win.drag_y = event.pageY;

    return false;
  }

  function window_mouse_up(event) {
    var win = document.tracking_window;

    // show's over folks...
    document.removeEventListener('mousemove', window_mouse_move, false);
    document.removeEventListener('mouseup', window_mouse_up, false);
    document.tracking_window = undefined;
    win.drag_x = undefined;
    win.drag_y = undefined;
    return true;  // consume event
  }

  function window_mouse_move(event) {
    var win = document.tracking_window;

    if (win.drag_x) {
      var dx = event.pageX - win.drag_x;
      var dy = event.pageY - win.drag_y;

      // move the window
      win.left += dx;
      win.top += dy;
      win.style.left = win.left + 'px';
      win.style.top = win.top + 'px';

      // update reference point
      win.drag_x += dx;
      win.drag_y += dy;

      return true;  // consume event
    }
  }

  ///////////////////////////////////////////////////////////////////////////////
  //
  //  Toolbar
  //
  ////////////////////////////////////////////////////////////////////////////////

  Schematic.prototype.add_tool = function (icon, tip, callback) {
    var tool;
    if (icon.search('data:image') != -1) {
      tool = document.createElement('img');
      tool.src = icon;
    } else if (icon.search('fa fa-fw') != -1) {
      tool = document.createElement('span');
      tool.setAttribute('class', icon);
      tool.style.color = icon_style;
    }
    else {
      tool = document.createElement('span');
      tool.style.font = 'small-caps small sans-serif';
      tool.style.color = icon_style;
      var label = document.createTextNode(icon);
      tool.appendChild(label);
    }

    // decorate tool
    tool.style.borderWidth = '1px';
    tool.style.borderStyle = 'solid';
    tool.style.borderColor = background_style;
    tool.style.padding = '8px 3px 8px 3px';
    tool.style.verticalAlign = 'middle';
    tool.style.cursor = 'default';

    // set up event processing
    tool.addEventListener('mouseover', tool_enter, false);
    tool.addEventListener('mouseout', tool_leave, false);
    tool.addEventListener('click', tool_click, false);

    // add to toolbar
    tool.sch = this;
    tool.tip = tip;
    tool.callback = callback;
    this.toolbar.push(tool);

    tool.enabled = false;
    tool.style.opacity = 0.2;

    return tool;
  }

  Schematic.prototype.enable_tool = function (tname, which) {
    var tool = this.tools[tname];

    if (tool != undefined) {
      tool.style.opacity = which ? 1.0 : 0.2;
      tool.enabled = which;

      // if disabling tool, remove border and tip
      if (!which) {
        tool.style.borderColor = background_style;
        tool.sch.message('');
      }
    }
  }

  // highlight tool button by turning on border, changing background
  function tool_enter(event) {
    if (!event) event = window.event;
    var tool = event.target;

    if (tool.enabled) {
      tool.style.borderColor = border_style;
      tool.sch.message(tool.tip);
      tool.opacity = 1.0;
    }
  }

  // unhighlight tool button by turning off border, reverting to normal background
  function tool_leave(event) {
    if (!event) event = window.event;
    var tool = event.target;

    if (tool.enabled) {
      tool.style.borderColor = background_style;
      tool.sch.message('');
    }
  }

  // handle click on a tool
  function tool_click(event) {
    if (!event) event = window.event;
    var tool = event.target;

    if (tool.enabled) {
      tool.sch.canvas.relMouseCoords(event);  // so we can position pop-up window correctly
      tool.callback.call(tool.sch);
    }
  }

  var help_icon = 'fa fa-fw fa-question-circle-o fa-lg';
  var cut_icon = 'fa fa-fw fa-scissors fa-lg';
  var copy_icon = 'fa fa-fw fa-files-o fa-lg';
  var paste_icon = 'fa fa-fw fa-clipboard fa-lg';
  var close_icon = 'fa fa-fw fa-times fa-lg';
  var grid_icon = 'fa fa-fw fa-table fa-lg';
  var delete_icon = 'fa fa-fw fa-times fa-lg';
  var rotate_icon = 'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz4NCjwhLS0gR2VuZXJhdG9yOiBBZG9iZSBJbGx1c3RyYXRvciAxOS4xLjAsIFNWRyBFeHBvcnQgUGx1Zy1JbiAuIFNWRyBWZXJzaW9uOiA2LjAwIEJ1aWxkIDApICAtLT4NCjxzdmcgdmVyc2lvbj0iMS4xIiBpZD0iTGF5ZXJfMSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayIgeD0iMHB4IiB5PSIwcHgiDQoJIHdpZHRoPSIxOC45cHgiIGhlaWdodD0iMTkuMnB4IiB2aWV3Qm94PSIwIDAgMTguOSAxOS4yIiBzdHlsZT0iZW5hYmxlLWJhY2tncm91bmQ6bmV3IDAgMCAxOC45IDE5LjI7IiB4bWw6c3BhY2U9InByZXNlcnZlIj4NCjxzdHlsZSB0eXBlPSJ0ZXh0L2NzcyI+DQoJLnN0MHtmb250LWZhbWlseTonUHJveGltYU5vdmEtQm9sZCc7fQ0KCS5zdDF7Zm9udC1zaXplOjE2cHg7fQ0KCS5zdDJ7c3Ryb2tlOiMwMDAwMDA7c3Ryb2tlLWxpbmVqb2luOnJvdW5kO3N0cm9rZS1taXRlcmxpbWl0OjEwO30NCgkuc3Qze2ZpbGw6bm9uZTtzdHJva2U6IzAwMDAwMDtzdHJva2Utd2lkdGg6MztzdHJva2UtbWl0ZXJsaW1pdDoxMDt9DQo8L3N0eWxlPg0KPHRleHQgdHJhbnNmb3JtPSJtYXRyaXgoMSAwIDAgMSAtMC4yNjIxIDE4LjEzNjkpIiBjbGFzcz0ic3QwIHN0MSI+UjwvdGV4dD4NCjxwb2x5Z29uIGNsYXNzPSJzdDIiIHBvaW50cz0iMTQuOSwxNS44IDExLjgsMTAuOSAxNy42LDExICIvPg0KPHBhdGggY2xhc3M9InN0MyIgZD0iTTE0LjcsMTAuN2MwLTQuOC00LjctOC43LTEwLjYtOC43Ii8+DQo8L3N2Zz4NCg=='
  var spacer_icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAYAAAASCAYAAAB4i6/FAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAACXBIWXMAABcSAAAXEgFnn9JSAAABWWlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iWE1QIENvcmUgNS40LjAiPgogICA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPgogICAgICA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIgogICAgICAgICAgICB4bWxuczp0aWZmPSJodHRwOi8vbnMuYWRvYmUuY29tL3RpZmYvMS4wLyI+CiAgICAgICAgIDx0aWZmOk9yaWVudGF0aW9uPjE8L3RpZmY6T3JpZW50YXRpb24+CiAgICAgIDwvcmRmOkRlc2NyaXB0aW9uPgogICA8L3JkZjpSREY+CjwveDp4bXBtZXRhPgpMwidZAAAADklEQVQYGWNgGAVDOwQAAcIAAVPQQlcAAAAASUVORK5CYII='
  var save_icon = 'fa fa-fw fa-save fa-lg';
  var open_icon = 'fa fa-fw fa-folder-open-o fa-lg';
  var link_icon = 'fa fa-fw fa-link fa-lg';

  ///////////////////////////////////////////////////////////////////////////////
  //
  //  Graphing
  //
  ///////////////////////////////////////////////////////////////////////////////

  // add dashed lines!
  // from http://davidowens.wordpress.com/2010/09/07/html-5-canvas-and-dashed-lines/
  try {
    if (CanvasRenderingContext2D)
      CanvasRenderingContext2D.prototype.dashedLineTo = function (fromX, fromY, toX, toY, pattern) {
        // Our growth rate for our line can be one of the following:
        //   (+,+), (+,-), (-,+), (-,-)
        // Because of this, our algorithm needs to understand if the x-coord and
        // y-coord should be getting smaller or larger and properly cap the values
        // based on (x,y).
        var lt = function (a, b) {
          return a <= b;
        };
        var gt = function (a, b) {
          return a >= b;
        };
        var capmin = function (a, b) {
          return Math.min(a, b);
        };
        var capmax = function (a, b) {
          return Math.max(a, b);
        };
        var checkX = {thereYet: gt, cap: capmin};
        var checkY = {thereYet: gt, cap: capmin};

        if (fromY - toY > 0) {
          checkY.thereYet = lt;
          checkY.cap = capmax;
        }
        if (fromX - toX > 0) {
          checkX.thereYet = lt;
          checkX.cap = capmax;
        }

        this.moveTo(fromX, fromY);
        var offsetX = fromX;
        var offsetY = fromY;
        var idx = 0, dash = true;
        while (!(checkX.thereYet(offsetX, toX) && checkY.thereYet(offsetY, toY))) {
          var ang = Math.atan2(toY - fromY, toX - fromX);
          var len = pattern[idx];

          offsetX = checkX.cap(toX, offsetX + (Math.cos(ang) * len));
          offsetY = checkY.cap(toY, offsetY + (Math.sin(ang) * len));

          if (dash) this.lineTo(offsetX, offsetY);
          else this.moveTo(offsetX, offsetY);

          idx = (idx + 1) % pattern.length;
          dash = !dash;
        }
      };
  }
  catch (err) { //noop
  }
  // given a range of values, return a new range [vmin',vmax'] where the limits
  // have been chosen "nicely".  Taken from matplotlib.ticker.LinearLocator
  function view_limits(vmin, vmax) {
    // deal with degenerate case...
    if (vmin == vmax) {
      if (vmin == 0) {
        vmin = -0.5;
        vmax = 0.5;
      }
      else {
        vmin = vmin > 0 ? 0.9 * vmin : 1.1 * vmin;
        vmax = vmax > 0 ? 1.1 * vmax : 0.9 * vmax;
      }
    }

    var log_range = Math.log(vmax - vmin) / Math.LN10;
    var exponent = Math.floor(log_range);
    //if (log_range - exponent < 0.5) exponent -= 1;
    var scale = Math.pow(10, -exponent);
    vmin = Math.floor(scale * vmin) / scale;
    vmax = Math.ceil(scale * vmax) / scale;

    return [vmin, vmax, 1.0 / scale];
  }

  function engineering_notation(n, nplaces, trim) {
    if (n == 0) return '0';
    if (Math.abs(n) < 1e-20) return '0';	//flatten tiny numbers to zero
    if (n == undefined) return 'undefined';
    if (trim == undefined) trim = true;

    var sign = n < 0 ? -1 : 1;
    var log10 = Math.log(sign * n) / Math.LN10;
    var exp = Math.floor(log10 / 3);   // powers of 1000
    var mantissa = sign * Math.pow(10, log10 - 3 * exp);

    // keep specified number of places following decimal point
    var mstring = (mantissa + sign * 0.5 * Math.pow(10, -nplaces)).toString();
    var mlen = mstring.length;
    var endindex = mstring.indexOf('.');
    if (endindex != -1) {
      if (nplaces > 0) {
        endindex += nplaces + 1;
        if (endindex > mlen) endindex = mlen;
        if (trim) {
          while (mstring.charAt(endindex - 1) == '0') endindex -= 1;
          if (mstring.charAt(endindex - 1) == '.') endindex -= 1;
        }
      }
      if (endindex < mlen)
        mstring = mstring.substring(0, endindex);
    }

    switch (exp) {
      case -5:
        return mstring + "f";
      case -4:
        return mstring + "p";
      case -3:
        return mstring + "n";
      case -2:
        return mstring + "u";
      case -1:
        return mstring + "m";
      case 0:
        return mstring;
      case 1:
        return mstring + "K";
      case 2:
        return mstring + "M";
      case 3:
        return mstring + "G";
    }

    // don't have a good suffix, so just print the number
    return n.toPrecision(4);

  }

  var grid_pattern = [1, 2];
  var cursor_pattern = [5, 5];

  // x_values is an array of x coordinates for each of the plots
  // y_values is an array of [color, value_array], one entry for each plot on left vertical axis
  // z_values is an array of [color, value_array], one entry for each plot on right vertical axis
  Schematic.prototype.graph = function (x_values, x_legend, y_values, y_legend, z_values, z_legend) {
    var pwidth = 400;	// dimensions of actual plot
    var pheight = 300;	// dimensions of actual plot
    var left_margin = (y_values != undefined && y_values.length > 0) ? 65 : 25;
    var top_margin = 25;
    var right_margin = (z_values != undefined && z_values.length > 0) ? 65 : 25;
    var bottom_margin = 45;
    var tick_length = 5;

    var w = pwidth + left_margin + right_margin;
    var h = pheight + top_margin + bottom_margin;

    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.style.display = 'block';		//gets rid of the little sliver of default padding at the bottom.


    // the graph itself will be drawn here and this image will be copied
    // onto canvas, where it can be overlayed with mouse cursors, etc.
    var bg_image = document.createElement('canvas');
    bg_image.width = w;
    bg_image.height = h;
    canvas.bg_image = bg_image;	// so we can find it during event handling

    // start by painting an opaque background
    var c = bg_image.getContext('2d');
    c.fillStyle = background_style;
    c.fillRect(0, 0, w, h);
    c.fillStyle = element_style;
    c.fillRect(left_margin, top_margin, pwidth, pheight);

    // figure out scaling for plots
    var x_min = array_min(x_values);
    var x_max = array_max(x_values);
    var x_limits = view_limits(x_min, x_max);
    x_min = x_limits[0];
    x_max = x_limits[1];
    var x_scale = pwidth / (x_max - x_min);

    function plot_x(x) {
      return (x - x_min) * x_scale + left_margin;
    }

    // draw x grid
    c.strokeStyle = grid_style;
    c.lineWidth = 1;
    c.fillStyle = normal_style;
    c.font = '10pt sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'top';
    var end = top_margin + pheight;
    for (var x = x_min; x <= x_max; x += x_limits[2]) {
      var temp = plot_x(x) + 0.5;  // keep lines crisp!

      // grid line
      c.beginPath();
      if (x == x_min) {
        c.moveTo(temp, top_margin);
        c.lineTo(temp, end);
      } else
        c.dashedLineTo(temp, top_margin, temp, end, grid_pattern);
      c.stroke();

      // tick mark
      c.beginPath();
      c.moveTo(temp, end);
      c.lineTo(temp, end + tick_length);
      c.stroke();
      c.fillText(engineering_notation(x, 2), temp, end + tick_length);
    }

    if (y_values != undefined && y_values.length > 0) {
      var y_min = Infinity;
      var y_max = -Infinity;
      var plot;
      for (plot = y_values.length - 1; plot >= 0; --plot) {
        var values = y_values[plot][2];
        if (values == undefined) continue;  // no data points
        var offset = y_values[plot][1];
        var temp = array_min(values) + offset;
        if (temp < y_min) y_min = temp;
        temp = array_max(values) + offset;
        if (temp > y_max) y_max = temp;
      }
      var y_limits = view_limits(y_min, y_max);
      y_min = y_limits[0];
      y_max = y_limits[1];
      var y_scale = pheight / (y_max - y_min);

      function plot_y(y) {
        return (y_max - y) * y_scale + top_margin;
      }

      // draw y grid
      c.textAlign = 'right';
      c.textBaseline = 'middle';
      for (var y = y_min; y <= y_max; y += y_limits[2]) {
        if (Math.abs(y / y_max) < 0.001) y = 0.0; // Just 3 digits
        var temp = plot_y(y) + 0.5;  // keep lines crisp!

        // grid line
        c.beginPath();
        if (y == y_min) {
          c.moveTo(left_margin, temp);
          c.lineTo(left_margin + pwidth, temp);
        } else
          c.dashedLineTo(left_margin, temp, left_margin + pwidth, temp, grid_pattern);
        c.stroke();

        // tick mark
        c.beginPath();
        c.moveTo(left_margin - tick_length, temp);
        c.lineTo(left_margin, temp);
        c.stroke();
        c.fillText(engineering_notation(y, 2), left_margin - tick_length - 2, temp);
      }

      // now draw each plot
      var x, y;
      var nx, ny;
      c.lineWidth = 3;
      c.lineCap = 'round';
      for (plot = y_values.length - 1; plot >= 0; --plot) {
        var color = probe_colors_rgb[y_values[plot][0]];
        if (color == undefined) continue;  // no plot color (== xaxis)
        c.strokeStyle = color;
        var values = y_values[plot][2];
        if (values == undefined) continue;  // no data points
        var offset = y_values[plot][1];

        x = plot_x(x_values[0]);
        y = plot_y(values[0] + offset);
        c.beginPath();
        c.moveTo(x, y);
        for (var i = 1; i < x_values.length; i++) {
          nx = plot_x(x_values[i]);
          ny = plot_y(values[i] + offset);
          c.lineTo(nx, ny);
          x = nx;
          y = ny;
          if (i % 100 == 99) {
            // too many lineTo's cause canvas to break
            c.stroke();
            c.beginPath();
            c.moveTo(x, y);
          }
        }
        c.stroke();
      }
    }

    if (z_values != undefined && z_values.length > 0) {
      var z_min = Infinity;
      var z_max = -Infinity;
      for (plot = z_values.length - 1; plot >= 0; --plot) {
        var values = z_values[plot][2];
        if (values == undefined) continue;  // no data points
        var offset = z_values[plot][1];
        var temp = array_min(values) + offset;
        if (temp < z_min) z_min = temp;
        temp = array_max(values) + offset;
        if (temp > z_max) z_max = temp;
      }
      var z_limits = view_limits(z_min, z_max);
      z_min = z_limits[0];
      z_max = z_limits[1];
      var z_scale = pheight / (z_max - z_min);

      function plot_z(z) {
        return (z_max - z) * z_scale + top_margin;
      }

      // draw z ticks
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      c.lineWidth = 1;
      c.strokeStyle = normal_style;
      var tick_length_half = Math.floor(tick_length / 2);
      var tick_delta = tick_length - tick_length_half;
      for (var z = z_min; z <= z_max; z += z_limits[2]) {
        if (Math.abs(z / z_max) < 0.001) z = 0.0; // Just 3 digits
        var temp = plot_z(z) + 0.5;  // keep lines crisp!

        // tick mark
        c.beginPath();
        c.moveTo(left_margin + pwidth - tick_length_half, temp);
        c.lineTo(left_margin + pwidth + tick_delta, temp);
        c.stroke();
        c.fillText(engineering_notation(z, 2), left_margin + pwidth + tick_length + 2, temp);
      }

      var z;
      var nz;
      c.lineWidth = 3;
      for (plot = z_values.length - 1; plot >= 0; --plot) {
        var color = probe_colors_rgb[z_values[plot][0]];
        if (color == undefined) continue;  // no plot color (== xaxis)
        c.strokeStyle = color;
        var values = z_values[plot][2];
        if (values == undefined) continue;  // no data points
        var offset = z_values[plot][1];

        x = plot_x(x_values[0]);
        z = plot_z(values[0] + offset);
        c.beginPath();
        c.moveTo(x, z);
        for (var i = 1; i < x_values.length; i++) {
          nx = plot_x(x_values[i]);
          nz = plot_z(values[i] + offset);
          c.lineTo(nx, nz);
          x = nx;
          z = nz;
          if (i % 100 == 99) {
            // too many lineTo's cause canvas to break
            c.stroke();
            c.beginPath();
            c.moveTo(x, z);
          }
        }
        c.stroke();
      }
    }

    // draw legends
    c.font = '12pt sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'bottom';
    c.fillText(x_legend, left_margin + pwidth / 2, h - 5);

    if (y_values != undefined && y_values.length > 0) {
      c.textBaseline = 'top';
      c.save();
      c.translate(5, top_margin + pheight / 2);
      c.rotate(-Math.PI / 2);
      c.fillText(y_legend, 0, 0);
      c.restore();
    }

    if (z_values != undefined && z_values.length > 0) {
      c.textBaseline = 'bottom';
      c.save();
      c.translate(w - 5, top_margin + pheight / 2);
      c.rotate(-Math.PI / 2);
      c.fillText(z_legend, 0, 0);
      c.restore();
    }

    // save info need for interactions with the graph
    canvas.x_values = x_values;
    canvas.y_values = y_values;
    canvas.z_values = z_values;
    canvas.x_legend = x_legend;
    canvas.y_legend = y_legend;
    canvas.z_legend = y_legend;
    canvas.x_min = x_min;
    canvas.x_scale = x_scale;
    canvas.y_min = y_min;
    canvas.y_scale = y_scale;
    canvas.z_min = z_min;
    canvas.z_scale = z_scale;
    canvas.left_margin = left_margin;
    canvas.top_margin = top_margin;
    canvas.pwidth = pwidth;
    canvas.pheight = pheight;
    canvas.tick_length = tick_length;

    canvas.cursor1_x = undefined;
    canvas.cursor2_x = undefined;
    canvas.sch = this;

    // do something useful when user mouses over graph
    canvas.addEventListener('mousemove', graph_mouse_move, false);

    // return our masterpiece
    redraw_plot(canvas);
    return canvas;
  }

  function array_max(a) {
    var max = -Infinity;
    for (var i = a.length - 1; i >= 0; --i)
      if (a[i] > max) max = a[i];
    return max;
  }

  function array_min(a) {
    var min = Infinity;
    for (var i = a.length - 1; i >= 0; --i)
      if (a[i] < min) min = a[i];
    return min;
  }

  function plot_cursor(c, graph, cursor_x, left_margin) {
    // draw dashed vertical marker that follows mouse
    var x = graph.left_margin + cursor_x;
    var end_y = graph.top_margin + graph.pheight + graph.tick_length;
    c.strokeStyle = stroke_style;
    c.lineWidth = 1;
    c.beginPath();
    c.dashedLineTo(x, graph.top_margin, x, end_y, cursor_pattern);
    c.stroke();

    // add x label at bottom of marker
    var graph_x = cursor_x / graph.x_scale + graph.x_min;
    c.font = '10pt sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'top';
    c.fillStyle = background_style;
    c.globalAlpha = 0.85;
    c.fillText('\u2588\u2588\u2588\u2588\u2588', x, end_y);
    c.globalAlpha = 1.0;
    c.fillStyle = normal_style;
    c.fillText(engineering_notation(graph_x, 3, false), x, end_y);

    // compute which points marker is between
    var x_values = graph.x_values;
    var len = x_values.length;
    var index = 0;
    while (index < len && graph_x >= x_values[index]) index += 1;
    var x1 = (index == 0) ? x_values[0] : x_values[index - 1];
    var x2 = x_values[index];

    if (x2 != undefined) {
      // for each plot, interpolate and output value at intersection with marker
      c.textAlign = 'left';
      var tx = graph.left_margin + left_margin;
      var ty = graph.top_margin + 3;
      if (graph.y_values != undefined) {
        for (var plot = 0; plot < graph.y_values.length; plot++) {
          var values = graph.y_values[plot][2];
          var color = probe_colors_rgb[graph.y_values[plot][0]];
          if (values == undefined || color == undefined) continue;  // no data points or xaxis

          // interpolate signal value at graph_x using values[index-1] and values[index]
          var y1 = (index == 0) ? values[0] : values[index - 1];
          var y2 = values[index];
          var y = y1;
          if (graph_x != x1) y += (graph_x - x1) * (y2 - y1) / (x2 - x1);

          // annotate plot with value of signal at marker
          c.fillStyle = element_style;
          c.globalAlpha = 0.5;
          c.fillText('\u2588\u2588\u2588\u2588\u2588', tx - 3, ty);
          c.globalAlpha = 1.0;
          c.fillStyle = color;
          c.fillText(engineering_notation(y, 3, false), tx, ty);
          ty += 14;
        }
      }

      c.textAlign = 'right';
      if (graph.z_values != undefined) {
        var tx = graph.left_margin + graph.pwidth - left_margin;
        var ty = graph.top_margin + 3;
        for (var plot = 0; plot < graph.z_values.length; plot++) {
          var values = graph.z_values[plot][2];
          var color = probe_colors_rgb[graph.z_values[plot][0]];
          if (values == undefined || color == undefined) continue;  // no data points or xaxis

          // interpolate signal value at graph_x using values[index-1] and values[index]
          var z1 = (index == 0) ? values[0] : values[index - 1];
          var z2 = values[index];
          var z = z1;
          if (graph_x != x1) z += (graph_x - x1) * (z2 - z1) / (x2 - x1);

          // annotate plot with value of signal at marker
          c.fillStyle = element_style;
          c.globalAlpha = 0.5;
          c.fillText('\u2588\u2588\u2588\u2588\u2588', tx + 3, ty);
          c.globalAlpha = 1.0;
          c.fillStyle = color;
          c.fillText(engineering_notation(z, 3, false), tx, ty);
          ty += 14;
        }
      }
    }
  }

  function redraw_plot(graph) {
    var c = graph.getContext('2d');
    c.drawImage(graph.bg_image, 0, 0);

    if (graph.cursor1_x != undefined) plot_cursor(c, graph, graph.cursor1_x, 4);
    if (graph.cursor2_x != undefined) plot_cursor(c, graph, graph.cursor2_x, 30);
  }

  function graph_mouse_move(event) {
    if (!event) event = window.event;
    var g = event.target;

    g.relMouseCoords(event);
    // not sure yet where the 3,-3 offset correction comes from (borders? padding?)
    var gx = g.mouse_x - g.left_margin - 3;
    var gy = g.pheight - (g.mouse_y - g.top_margin) + 3;
    if (gx >= 0 && gx <= g.pwidth && gy >= 0 && gy <= g.pheight) {
      //g.sch.message('button: '+event.button+', which: '+event.which);
      g.cursor1_x = gx;
    } else {
      g.cursor1_x = undefined;
      g.cursor2_x = undefined;
    }

    redraw_plot(g);
  }

  ///////////////////////////////////////////////////////////////////////////////
  //
  //  Parts bin
  //
  ////////////////////////////////////////////////////////////////////////////////

  // one instance will be created for each part in the parts bin
  function Part(sch) {
    this.sch = sch;
    this.component = undefined;
    this.selected = false;

    // set up canvas
    this.canvas = document.createElement('canvas');
    this.canvas.style.borderStyle = 'solid';
    this.canvas.style.borderWidth = '1px';
    this.canvas.style.borderColor = background_style;
    //this.canvas.style.position = 'absolute';
    this.canvas.style.cursor = 'default';
    this.canvas.height = part_w;
    this.canvas.width = part_h;
    this.canvas.part = this;

    this.canvas.addEventListener('mouseover', part_enter, false);
    this.canvas.addEventListener('mouseout', part_leave, false);
    this.canvas.addEventListener('mousedown', part_mouse_down, false);
    this.canvas.addEventListener('mouseup', part_mouse_up, false);

    this.canvas.addEventListener('touchstart', part_mouse_down, false);
    this.canvas.addEventListener('touchend', part_mouse_up, false);

    // make the part "clickable" by registering a dummy click handler
    // this should make things work on the iPad
    this.canvas.addEventListener('click', function () {
    }, false);
  }

  Part.prototype.set_location = function (left, top) {
    this.canvas.style.left = left + 'px';
    this.canvas.style.top = top + 'px';
  }

  Part.prototype.right = function () {
    return this.canvas.offsetLeft + this.canvas.offsetWidth;
  }

  Part.prototype.bottom = function () {
    return this.canvas.offsetTop + this.canvas.offsetHeight;
  }

  Part.prototype.set_component = function (component, tip) {
    component.sch = this;
    this.component = component;
    this.tip = tip;

    // figure out scaling and centering of parts icon
    var b = component.bounding_box;
    var dx = b[2] - b[0];
    var dy = b[3] - b[1];
    this.scale = 1.0; //Math.min(part_w/(1.2*dx),part_h/(1.2*dy));
    this.origin_x = b[0] + dx / 2.0 - part_w / (2.0 * this.scale);
    this.origin_y = b[1] + dy / 2.0 - part_h / (2.0 * this.scale);

    this.redraw();
  }

  Part.prototype.redraw = function (part) {
    var c = this.canvas.getContext('2d');

    // paint background color behind selected part in bin,
    // WMc: commmented out (background stays stuck on in mobile). Black border is sufficient.
    c.fillStyle = this.selected ? selected_style : background_style;
    c.fillRect(0,0,part_w,part_h);

    if (this.component) this.component.draw(c);
  }

  Part.prototype.select = function (which) { // select from the sidebar menu
    this.selected = which;
    //console.log(this);
    this.redraw();
  }

  Part.prototype.update_connection_point = function (cp, old_location) {
    // no connection points in the parts bin
  }

  Part.prototype.moveTo = function (c, x, y) {
    c.moveTo((x - this.origin_x) * this.scale, (y - this.origin_y) * this.scale);
  }

  Part.prototype.lineTo = function (c, x, y) {
    c.lineTo((x - this.origin_x) * this.scale, (y - this.origin_y) * this.scale);
  }

  Part.prototype.draw_line = function (c, x1, y1, x2, y2, width) {
    c.lineWidth = width * this.scale;
    c.beginPath();
    c.moveTo((x1 - this.origin_x) * this.scale, (y1 - this.origin_y) * this.scale);
    c.lineTo((x2 - this.origin_x) * this.scale, (y2 - this.origin_y) * this.scale);
    c.stroke();
  }

  Part.prototype.draw_arc = function (c, x, y, radius, start_radians, end_radians, anticlockwise, width, filled) {
    c.lineWidth = width * this.scale;
    c.beginPath();
    c.arc((x - this.origin_x) * this.scale, (y - this.origin_y) * this.scale, radius * this.scale,
      start_radians, end_radians, anticlockwise);
    if (filled) c.fill();
    else c.stroke();
  }

  Part.prototype.draw_text = function (c, text, x, y, size) {
    // no text displayed for the parts icon
  }

  function part_enter(event) {
    if (!event) event = window.event;
    var canvas = event.target;
    var part = canvas.part;

    // avoid Chrome bug that changes to text cursor whenever
    // drag starts.  We'll restore the default handler at
    // the appropriate point so behavior in other parts of
    // the document are unaffected.
    //part.sch.saved_onselectstart = document.onselectstart;
    //document.onselectstart = function () { return false; };

    canvas.style.borderColor = border_style;
    part.sch.message(part.tip );
    //part.sch.message(part.tip);
    return false;
  }

  function part_leave(event) {
    if (!event) event = window.event;
    var canvas = event.target;
    var part = canvas.part;

    if (typeof part.sch.new_part == 'undefined') {
      // leaving with no part selected?  revert handler
      //document.onselectstart = part.sch.saved_onselectstart;
    }

    canvas.style.borderColor = background_style;
    part.sch.message('');
    return false;
  }

  function part_mouse_down(event) {
    if (!event) event = window.event;
    var part = event.target.part;
    //console.log(part);
    part.select(true);
    for(c of part.sch.parts_bin)
    { if (c != part)
      c.select(false) ;
    }
    part.sch.new_part = part;
    return false;
  }

  function part_mouse_up(event) {
    if (!event) event = window.event;
    var part = event.target.part;
    if(!part.component.is_const)
    part.select(false);					// commented out for touch
    part.sch.new_part = undefined;		// for touch, place parts with touch-touch instead of drag
    return false;							// on desktop, both drag and click-click work
  }

  ////////////////////////////////////////////////////////////////////////////////
  //
  //  Rectangle helper functions
  //
  ////////////////////////////////////////////////////////////////////////////////

  // rect is an array of the form [left,top,right,bottom]

  // ensure left < right, top < bottom
  function canonicalize(r) {
    var temp;

    // canonicalize bounding box
    if (r[0] > r[2]) {
      temp = r[0];
      r[0] = r[2];
      r[2] = temp;
    }
    if (r[1] > r[3]) {
      temp = r[1];
      r[1] = r[3];
      r[3] = temp;
    }
  }

  function between(x, x1, x2) {
    return x1 <= x && x <= x2;
  }

  function inside(rect, x, y) {
    return between(x, rect[0], rect[2]) && between(y, rect[1], rect[3]);
  }

  // only works for manhattan rectangles
  function intersect(r1, r2) {
    // look for non-intersection, negate result
    var result = !(r2[0] > r1[2] ||
      r2[2] < r1[0] ||
      r2[1] > r1[3] ||
      r2[3] < r1[1]);

    // if I try to return the above expression, javascript returns undefined!!!
    return result;
  }

  ////////////////////////////////////////////////////////////////////////////////
  //
  //  Component base class
  //
  ////////////////////////////////////////////////////////////////////////////////

  function Component(type, x, y, rotation) {
    this.sch = undefined;
    this.type = type;
    this.x = x;
    this.y = y;
    this.rotation = rotation;
    this.selected = false;
    this.properties = [];
    this.bounding_box = [0, 0, 0, 0];   // in device coords [left,top,right,bottom]
    this.bbox = this.bounding_box;   // in absolute coords
    this.connections = [];
    this.is_const=false ;


  }

  Component.prototype.randomize = function(){}
  Component.prototype.get_value = function(){}

  Component.prototype.json = function (index) {
    this.properties['_json_'] = index; // remember where we are in the JSON list

    var props = {};
    for (var p in this.properties) props[p] = this.properties[p];

    var conns = [];
    for (var i = 0; i < this.connections.length; i++)
      conns.push(this.connections[i].json());

    var json = [this.type, [this.x, this.y, this.rotation], props, conns,this.is_const];
    return json;
  }

  Component.prototype.add_connection = function (offset_x, offset_y) {
    this.connections.push(new ConnectionPoint(this, offset_x, offset_y));
  }

  Component.prototype.update_coords = function () {
    var x = this.x;
    var y = this.y;

    // update bbox
    var b = this.bounding_box;
    this.bbox[0] = this.transform_x(b[0], b[1]) + x;
    this.bbox[1] = this.transform_y(b[0], b[1]) + y;
    this.bbox[2] = this.transform_x(b[2], b[3]) + x;
    this.bbox[3] = this.transform_y(b[2], b[3]) + y;
    canonicalize(this.bbox);

    // update connections
    for (var i = this.connections.length - 1; i >= 0; --i)
      this.connections[i].update_location();
  }

  Component.prototype.rotate = function (amount) {
    var old_rotation = this.rotation;
    this.rotation = (this.rotation + amount) % 8;
    this.update_coords();

    // create an undoable edit record here
    // using old_rotation
  }

  Component.prototype.move_begin = function () {
    // remember where we started this move
    this.move_x = this.x;
    this.move_y = this.y;
  }

  Component.prototype.move = function (dx, dy) {
    // update coordinates
    this.x += dx;
    this.y += dy;
    this.update_coords();
  }

  Component.prototype.move_end = function () {
    var dx = this.x - this.move_x;
    var dy = this.y - this.move_y;

    if (dx != 0 || dy != 0) {
      // create an undoable edit record here

      this.sch.check_wires(this);
    }
  }

  Component.prototype.add = function (sch) {
    this.sch = sch;   // we now belong to a schematic!
    sch.add_component(this);

    this.update_coords();
  }

  Component.prototype.remove = function () {
    // remove connection points from schematic
    for (var i = this.connections.length - 1; i >= 0; --i) {
      var cp = this.connections[i];
      this.sch.remove_connection_point(cp, cp.location);
    }

    // remove component from schematic
    this.sch.remove_component(this);
    this.sch = undefined;

    // create an undoable edit record here
  }

  Component.prototype.transform_x = function (x, y) {
    var rot = this.rotation;
    if (rot == 0 || rot == 6) return x;
    else if (rot == 1 || rot == 5) return -y;
    else if (rot == 2 || rot == 4) return -x;
    else return y;
  }

  Component.prototype.transform_y = function (x, y) {
    var rot = this.rotation;
    if (rot == 1 || rot == 7) return x;
    else if (rot == 2 || rot == 6) return -y;
    else if (rot == 3 || rot == 5) return -x;
    else return y;
  }

  Component.prototype.moveTo = function (c, x, y) {
    var nx = this.transform_x(x, y) + this.x;
    var ny = this.transform_y(x, y) + this.y;
    this.sch.moveTo(c, nx, ny);
  }

  Component.prototype.lineTo = function (c, x, y) {
    var nx = this.transform_x(x, y) + this.x;
    var ny = this.transform_y(x, y) + this.y;
    this.sch.lineTo(c, nx, ny);
  }

  Component.prototype.draw_line = function (c, x1, y1, x2, y2) {
    c.strokeStyle = this.selected ? selected_style :
      this.type == 'w' ? normal_style : component_style;
    var nx1 = this.transform_x(x1, y1) + this.x;
    var ny1 = this.transform_y(x1, y1) + this.y;
    var nx2 = this.transform_x(x2, y2) + this.x;
    var ny2 = this.transform_y(x2, y2) + this.y;
    this.sch.draw_line(c, nx1, ny1, nx2, ny2, 1);
  }

  Component.prototype.draw_circle = function (c, x, y, radius, filled) {
    if (filled) c.fillStyle = this.selected ? selected_style : normal_style;
    else c.strokeStyle = this.selected ? selected_style :
      this.type == 'w' ? normal_style : component_style;
    var nx = this.transform_x(x, y) + this.x;
    var ny = this.transform_y(x, y) + this.y;

    this.sch.draw_arc(c, nx, ny, radius, 0, 2 * Math.PI, false, 1, filled);
  }

  var rot_angle = [
    0.0,		// NORTH (identity)
    Math.PI / 2,	// EAST (rot270)
    Math.PI,	// SOUTH (rot180)
    3 * Math.PI / 2,  // WEST (rot90)
    0.0,		// RNORTH (negy)
    Math.PI / 2,	// REAST (int-neg)
    Math.PI,	// RSOUTH (negx)
    3 * Math.PI / 2,	// RWEST (int-pos)
  ];

  Component.prototype.draw_arc = function (c, x, y, radius, start_radians, end_radians) {
    c.strokeStyle = this.selected ? selected_style :
      this.type == 'w' ? normal_style : component_style;
    var nx = this.transform_x(x, y) + this.x;
    var ny = this.transform_y(x, y) + this.y;
    this.sch.draw_arc(c, nx, ny, radius,
      start_radians + rot_angle[this.rotation], end_radians + rot_angle[this.rotation],
      false, 1, false);
  }

  Component.prototype.draw = function (c) {
    /* for debug: puts X on connection points
         for (var i = this.connections.length - 1; i >= 0; --i) {
         var cp = this.connections[i];
         cp.draw_x(c);
         }
         */
  }

  // result of rotating an alignment [rot*9 + align]
  var aOrient = [
    0, 1, 2, 3, 4, 5, 6, 7, 8,		// NORTH (identity)
    2, 5, 8, 1, 4, 7, 0, 3, 6, 		// EAST (rot270)
    8, 7, 6, 5, 4, 3, 2, 1, 0,		// SOUTH (rot180)
    6, 3, 0, 7, 4, 1, 8, 5, 3,		// WEST (rot90)
    2, 1, 0, 5, 4, 3, 8, 7, 6,		// RNORTH (negy)
    8, 5, 2, 7, 4, 1, 6, 3, 0, 		// REAST (int-neg)
    6, 7, 8, 3, 4, 5, 0, 1, 2,		// RSOUTH (negx)
    0, 3, 6, 1, 4, 7, 2, 5, 8		// RWEST (int-pos)
  ];

  var textAlign = [
    'left', 'center', 'right',
    'left', 'center', 'right',
    'left', 'center', 'right'
  ];

  var textBaseline = [
    'top', 'top', 'top',
    'middle', 'middle', 'middle',
    'bottom', 'bottom', 'bottom'
  ];

  Component.prototype.draw_text = function (c, text, x, y, alignment, size, fill) {
    var a = aOrient[this.rotation * 9 + alignment];
    c.textAlign = textAlign[a];
    c.textBaseline = textBaseline[a];
    if (fill == undefined)
      c.fillStyle = this.selected ? selected_style : normal_style;
    else
      c.fillStyle = fill;
    this.sch.draw_text(c, text,
      this.transform_x(x, y) + this.x,
      this.transform_y(x, y) + this.y,
      size);
  }

  Component.prototype.set_select = function (which) {
    if (which != this.selected) {
      this.selected = which;
      // create an undoable edit record here
    }
  }

  Component.prototype.select = function (x, y, shiftKey) {
    this.was_previously_selected = this.selected;
    if (this.near(x, y)) {
      this.set_select(shiftKey ? !this.selected : true);
      return true;
    } else return false;
  }

  Component.prototype.select_rect = function (s) {
    this.was_previously_selected = this.selected;
    if (intersect(this.bbox, s))
      this.set_select(true);
  }

  // if connection point of component c bisects the
  // wire represented by this compononent, return that
  // connection point.  Otherwise return null.
  Component.prototype.bisect = function (c) {
    return null;
  }

  // does mouse click fall on this component?
  Component.prototype.near = function (x, y) {
    return inside(this.bbox, x, y);
  }

  Component.prototype.edit_properties = function (x, y) {
    if ( this.sch.is_static && !this.sch.allow_edits)
      return ;
    if (this.near(x, y) && ! this.is_const ) {
      // make an <input> widget for each property
      var fields = [];
      for (var i in this.properties)
        // underscore at beginning of property name => system property
      {
        //console.log(this.sch.is_static);
        //if static mode is applied than we can only edit the name
        if(this.sch.is_static )
        {
        if ( i =='name')
          fields[i] = build_input('text', 10, this.properties[i]);

        }
        else {
          if (i.charAt(0) != '_')
            fields[i] = build_input('text', 10, this.properties[i]);
        }
      }
      console.log(fields);
      var content = build_table(fields);
      content.fields = fields;
      content.component = this;

      this.sch.dialog(i18n.Edit_Properties, content, function (content) {
        for (var i in content.fields)
          content.component.properties[i] = content.fields[i].value;
        content.component.sch.redraw_background();
      });
      return true;
    } else return false;
  }

  Component.prototype.clear_labels = function () {
    for (var i = this.connections.length - 1; i >= 0; --i) {
      this.connections[i].clear_label();
    }
  }

  // default action: don't propagate label
  Component.prototype.propagate_label = function (label) {
  }

  // give components a chance to generate default labels for their connection(s)
  // default action: do nothing
  Component.prototype.add_default_labels = function () {
  }

  // component should generate labels for all unlabeled connections
  Component.prototype.label_connections = function () {
    for (var i = this.connections.length - 1; i >= 0; --i) {
      var cp = this.connections[i];
      if (!cp.label)
        cp.propagate_label(this.sch.get_next_label());
    }
  }

  // default behavior: no probe info
  Component.prototype.probe_info = function () {
    return undefined;
  }

  // default behavior: nothing to display for DC analysis
  Component.prototype.display_current = function (c, vmap) {
  }

  ////////////////////////////////////////////////////////////////////////////////
  //
  //  Connection point
  //
  ////////////////////////////////////////////////////////////////////////////////

  var connection_point_radius = 2;

  function ConnectionPoint(parent, x, y) {
    this.parent = parent;
    this.offset_x = x;
    this.offset_y = y;
    this.location = '';
    this.update_location();
    this.label = undefined;
  }

  ConnectionPoint.prototype.toString = function () {
    return '<ConnectionPoint (' + this.offset_x + ',' + this.offset_y + ') ' + this.parent.toString() + '>';
  }

  ConnectionPoint.prototype.json = function () {
    return this.label;
  }

  ConnectionPoint.prototype.clear_label = function () {
    this.label = undefined;
  }

  ConnectionPoint.prototype.propagate_label = function (label) {
    // should we check if existing label is the same?  it should be...

    if (this.label === undefined) {
      // label this connection point
      this.label = label;

      // propagate label to coincident connection points
      this.parent.sch.propagate_label(label, this.location);

      // possibly label other cp's for this device?
      this.parent.propagate_label(label);
    } else if (this.label != '0' && label != '0' && this.label != label)
      alert(i18n.Node_has_two_conflicting_labels + this.label + ', ' + label);
  }

  ConnectionPoint.prototype.update_location = function () {
    // update location string which we use as a key to find coincident connection points
    var old_location = this.location;
    var parent = this.parent;
    var nx = parent.transform_x(this.offset_x, this.offset_y) + parent.x;
    var ny = parent.transform_y(this.offset_x, this.offset_y) + parent.y;
    this.x = nx;
    this.y = ny;
    this.location = nx + ',' + ny;

    // add ourselves to the connection list for the new location
    if (parent.sch)
      parent.sch.update_connection_point(this, old_location);
  }

  ConnectionPoint.prototype.coincident = function (x, y) {
    return this.x == x && this.y == y;
  }

  ConnectionPoint.prototype.draw = function (c, n) {
    if (n != 2)
      this.parent.draw_circle(c, this.offset_x, this.offset_y, connection_point_radius, n > 2);
  }

  ConnectionPoint.prototype.draw_x = function (c) {
    this.parent.draw_line(c, this.offset_x - 2, this.offset_y - 2, this.offset_x + 2, this.offset_y + 2);
    this.parent.draw_line(c, this.offset_x + 2, this.offset_y - 2, this.offset_x - 2, this.offset_y + 2);
  }

  ConnectionPoint.prototype.display_voltage = function (c, vmap) {
    var v = vmap[this.label];
    if (v != undefined) {
      var label = v.toFixed(2) + 'V';

      // first draw some solid blocks in the background
      c.globalAlpha = 0.85;
      this.parent.draw_text(c, '\u2588\u2588\u2588', this.offset_x, this.offset_y,
        4, annotation_size, element_style);
      c.globalAlpha = 1.0;

      // display the node voltage at this connection point
      this.parent.draw_text(c, label, this.offset_x, this.offset_y,
        4, annotation_size, annotation_style);

      // only display each node voltage once
      delete vmap[this.label];
    }
  }

  // see if three connection points are collinear
  function collinear(p1, p2, p3) {
    // from http://mathworld.wolfram.com/Collinear.html
    var area = p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y);
    return area == 0;
  }

  ////////////////////////////////////////////////////////////////////////////////
  //
  //  Wire
  //
  ////////////////////////////////////////////////////////////////////////////////

  var near_distance = 2;   // how close to wire counts as "near by"

  function Wire(x1, y1, x2, y2,is_const) {
    // arbitrarily call x1,y1 the origin
    Component.call(this, 'w', x1, y1, 0);
    this.dx = x2 - x1;
    this.dy = y2 - y1;
    this.is_const= is_const;
    this.add_connection(0, 0);
    this.add_connection(this.dx, this.dy);

    // compute bounding box (expanded slightly)
    var r = [0, 0, this.dx, this.dy];
    canonicalize(r);
    r[0] -= near_distance;
    r[1] -= near_distance;
    r[2] += near_distance;
    r[3] += near_distance;
    this.bounding_box = r;
    this.update_coords();    // update bbox

    // used in selection calculations
    this.len = Math.sqrt(this.dx * this.dx + this.dy * this.dy);
  }

  Wire.prototype = new Component();
  Wire.prototype.constructor = Wire;

  Wire.prototype.toString = function () {
    return '<Wire (' + this.x + ',' + this.y + ') (' + (this.x + this.dx) + ',' + (this.y + this.dy) + ')>';
  }

  // return connection point at other end of wire from specified cp
  Wire.prototype.other_end = function (cp) {
    if (cp == this.connections[0]) return this.connections[1];
    else if (cp == this.connections[1]) return this.connections[0];
    else return undefined;
  }

  Wire.prototype.json = function (index) {
    var json = ['w', [this.x, this.y, this.x + this.dx, this.y + this.dy]];
    return json;
  }

  Wire.prototype.draw = function (c) {
    this.draw_line(c, 0, 0, this.dx, this.dy);
  }

  Wire.prototype.clone = function (x, y) {
    return new Wire(x, y, x + this.dx, y + this.dy,this.is_const);
  }

  Wire.prototype.near = function (x, y) {
    // crude check: (x,y) within expanded bounding box of wire
    if (inside(this.bbox, x, y)) {
      // compute distance between x,y and nearst point on line
      // http://www.allegro.cc/forums/thread/589720
      var D = Math.abs((x - this.x) * this.dy - (y - this.y) * this.dx) / this.len;
      if (D <= near_distance) return true;
    }
    return false;
  }

  // selection rectangle selects wire only if it includes
  // one of the end points
  Wire.prototype.select_rect = function (s) {
    this.was_previously_selected = this.selected;
    if (inside(s, this.x, this.y) || inside(s, this.x + this.dx, this.y + this.dy))
      this.set_select(true);
  }

  // if connection point cp bisects the
  // wire represented by this compononent, return true
  Wire.prototype.bisect_cp = function (cp) {
    var x = cp.x;
    var y = cp.y;

    // crude check: (x,y) within expanded bounding box of wire
    if (inside(this.bbox, x, y)) {
      // compute distance between x,y and nearst point on line
      // http://www.allegro.cc/forums/thread/589720
      var D = Math.abs((x - this.x) * this.dy - (y - this.y) * this.dx) / this.len;
      // final check: ensure point isn't an end point of the wire
      if (D < 1 && !this.connections[0].coincident(x, y) && !this.connections[1].coincident(x, y))
        return true;
    }
    return false;
  }

  // if some connection point of component c bisects the
  // wire represented by this compononent, return that
  // connection point.  Otherwise return null.
  Wire.prototype.bisect = function (c) {
    if (c == undefined) return;
    for (var i = c.connections.length - 1; i >= 0; --i) {
      var cp = c.connections[i];
      if (this.bisect_cp(cp)) return cp;
    }
    return null;
  }

  Wire.prototype.move_end = function () {
    // look for wires bisected by this wire
    this.sch.check_wires(this);

    // look for connection points that might bisect us
    this.sch.check_connection_points(this);
  }

  // wires "conduct" their label to the other end
  Wire.prototype.propagate_label = function (label) {
    // don't worry about relabeling a cp, it won't recurse!
    this.connections[0].propagate_label(label);
    this.connections[1].propagate_label(label);
  }

  // Wires have no properties to edit
  Wire.prototype.edit_properties = function (x, y) {
    return false;
  }

  // some actual component will start the labeling of electrical nodes,
  // so do nothing here
  Wire.prototype.label_connections = function () {
  }

  ////////////////////////////////////////////////////////////////////////////////
  //
  //  Ground
  //
  ////////////////////////////////////////////////////////////////////////////////

  function Ground(x, y, rotation,is_const) {
    Component.call(this, 'g', x, y, rotation);
    this.add_connection(0, 0);
    this.is_const=is_const;
    this.bounding_box = [-6, 0, 6, 14];
    this.update_coords();
  }

  Ground.prototype = new Component();
  Ground.prototype.constructor = Ground;

  Ground.prototype.toString = function () {
    return '<Ground (' + this.x + ',' + this.y + ')>';
  }

  Ground.prototype.draw = function (c) {
    Component.prototype.draw.call(this, c);   // give superclass a shot
    this.draw_line(c, 0, 0, 0, 8);
    this.draw_line(c, -6, 8, 6, 8);
    this.draw_line(c, -6, 8, 0, 14);
    this.draw_line(c, 0, 14, 6, 8);
  }

  Ground.prototype.clone = function (x, y,) {
    return new Ground(x, y, this.rotation,this.is_const);
  }

  // Grounds no properties to edit
  Ground.prototype.edit_properties = function (x, y) {
    return false;
  }

  // give components a chance to generate a label for their connection(s)
  // default action: do nothing
  Ground.prototype.add_default_labels = function () {
    this.connections[0].propagate_label('0');   // canonical label for GND node
  }

  ////////////////////////////////////////////////////////////////////////////////
  //
  //  Label
  //
  ////////////////////////////////////////////////////////////////////////////////

  function Label(x, y, rotation, label,is_const) {
    Component.call(this, 'L', x, y, rotation);
    this.properties['name'] = label ? label : '???';
    this.is_const=is_const;
    this.add_connection(0, 0);
    this.bounding_box = [-2, 0, 2, 8];
    this.update_coords();
  }

  Label.prototype = new Component();
  Label.prototype.constructor = Label;

  Label.prototype.toString = function () {
    return '<Label' + ' (' + this.x + ',' + this.y + ')>';
  }

  Label.prototype.draw = function (c) {
    Component.prototype.draw.call(this, c);   // give superclass a shot
    this.draw_line(c, 0, 0, 0, 8);
    this.draw_text(c, this.properties['name'], 0, 9, 1, property_size);
  }

  Label.prototype.clone = function (x, y) {
    return new Label(x, y, this.rotation, this.properties['name'],this.is_const);
  }

  // give components a chance to generate a label for their connection(s)
  // default action: do nothing
  Label.prototype.add_default_labels = function () {
    this.connections[0].propagate_label(this.properties['name']);
  }


  ////////////////////////////////////////////////////////////////////////////////
  //
  //  CLabel custom label
  //
  ////////////////////////////////////////////////////////////////////////////////

  function CLabel(x, y, rotation, label,is_const) {
    Component.call(this, 't', x, y, rotation);
    this.properties['name'] = label ? label : 'lab';
    this.properties['vales'] = '0';
    this.is_const=is_const;
    this.add_connection(0, 0);
    this.bounding_box = [-2, 0, 2, 8];
    this.update_coords();
  }

  CLabel.prototype = new Component();
  CLabel.prototype.constructor = CLabel;

  CLabel.prototype.toString = function () {
    return '<CLabel' + ' (' + this.x + ',' + this.y + ')>';
  }

  CLabel.prototype.draw = function (c) {
    Component.prototype.draw.call(this, c);   // give superclass a shot
    this.draw_line(c, 0, 0, 0, 0);
    this.draw_circle(c, 0, 0, 2, probe_colors.green);
    this.draw_text(c, this.properties['name'], -10, 0, 1, property_size);
    this.draw_text(c, this.properties['vales'], 10, 0, 1, property_size);

  }

  CLabel.prototype.clone = function (x, y) {
    return new CLabel(x, y, this.rotation, this.properties['name'],this.is_const);
  }

  // give components a chance to generate a label for their connection(s)
  // default action: do nothing
  CLabel.prototype.add_default_labels = function () {
    this.connections[0].propagate_label(this.properties['name']);
  }


  ////////////////////////////////////////////////////////////////////////////////
  //
  //  Voltage Probe
  //
  ////////////////////////////////////////////////////////////////////////////////

  var probe_colors = ['red', 'green', 'blue', 'cyan', 'magenta', 'yellow', 'black', 'xaxis'];
  // QQQ var probe_cnames = i18n_probe_cnames;	// color names, see i18n string file, en-US.js, etc.

  var probe_colors_rgb = {
    'red': 'rgb(232,77,57)',
    'green': 'rgb(31,171,84)',
    'blue': 'rgb(35,110,201)',
    'cyan': 'rgb(99,217,234)',
    'magenta': 'rgb(237,95,166)',
    'yellow': 'rgb(244,211,69)',
    'black': 'rgb(0,0,0)',
    'xaxis': undefined
  };

  function Probe(x, y, rotation, color, offset,is_const) {
    Component.call(this, 's', x, y, rotation);
    this.add_connection(0, 0);
    this.is_const=is_const;
    this.properties['color'] = color ? color : 'cyan';
    this.properties['offset'] = (offset == undefined || offset == '') ? '0' : offset;
    this.bounding_box = [0, 0, 27, -21];
    this.update_coords();
  }

  Probe.prototype = new Component();
  Probe.prototype.constructor = Probe;

  Probe.prototype.toString = function () {
    return '<Probe (' + this.x + ',' + this.y + ')>';
  }

  Probe.prototype.draw = function (c) {
    // draw outline
    this.draw_line(c, 0, 0, 4, -4);
    this.draw_line(c, 2, -6, 6, -2);
    this.draw_line(c, 2, -6, 17, -21);
    this.draw_line(c, 6, -2, 21, -17);
    this.draw_line(c, 17, -21, 21, -17);
    this.draw_arc(c, 19, -11, 8, 3 * Math.PI / 2, 0);

    // fill body with plot color
    var color = probe_colors_rgb[this.properties['color']];
    if (color != undefined) {
      c.fillStyle = color;
      c.beginPath();
      this.moveTo(c, 2, -6);
      this.lineTo(c, 6, -2);
      this.lineTo(c, 21, -17);
      this.lineTo(c, 17, -21);
      this.lineTo(c, 2, -6);
      c.fill();
    } else {
      this.draw_text(c, this.properties['color'], 27, -11, 1, property_size);
    }
  }

  Probe.prototype.clone = function (x, y) {
    return new Probe(x, y, this.rotation, this.properties['color'], this.properties['offset'],this.is_const);
  }

  Probe.prototype.edit_properties = function (x, y) {
    if (inside(this.bbox, x, y)) {
      var fields = [];
      var n = probe_colors.indexOf(this.properties['color']);
      //QQQ fields['Plot_color'] = build_select(probe_cnames,probe_cnames[n]);
      fields['Plot_color'] = build_select(probe_colors, probe_colors[n]);
      fields['Plot_offset'] = build_input('text', 10, this.properties['offset']);

      var content = build_table(fields);
      content.fields = fields;
      content.component = this;

      this.sch.dialog(i18n.Edit_Properties, content, function (content) {
        var color_choice = content.fields['Plot_color'];
        content.component.properties['color'] = probe_colors[color_choice.selectedIndex];
        content.component.properties['offset'] = content.fields['Plot_offset'].value;
        content.component.sch.redraw_background();
      });
      return true;
    } else return false;
  }

  // return [color, node_label, offset, type] for this probe
  Probe.prototype.probe_info = function () {
    var color = this.properties['color'];
    var offset = this.properties['offset'];
    if (offset == undefined || offset == "") offset = '0';
    return [color, this.connections[0].label, offset, 'voltage'];
  }

  ////////////////////////////////////////////////////////////////////////////////
  //
  //  Ammeter Probe
  //
  ////////////////////////////////////////////////////////////////////////////////

  function Ammeter(x, y, rotation, color, offset,is_const) {
    Component.call(this, 'a', x, y, rotation);
    this.add_connection(0, 0);   // pos
    this.add_connection(16, 0);   // neg
    this.properties['color'] = color ? color : 'magenta';
    this.properties['offset'] = (offset == undefined || offset == '') ? '0' : offset;
    this.bounding_box = [-3, 0, 16, 3];
    this.is_const=is_const;
    this.update_coords();
  }

  Ammeter.prototype = new Component();
  Ammeter.prototype.constructor = Ammeter;

  Ammeter.prototype.toString = function () {
    return '<Ammeter (' + this.x + ',' + this.y + ')>';
  }

  Ammeter.prototype.move_end = function () {
    Component.prototype.move_end.call(this);   // do the normal processing

    // special for current probes: see if probe has been placed
    // in the middle of wire, creating three wire segments one
    // of which is shorting the two terminals of the probe.  If
    // so, auto remove the shorting segment.
    var e1 = this.connections[0].location;
    var e2 = this.connections[1].location;
    var cplist = this.sch.find_connections(this.connections[0]);
    for (var i = cplist.length - 1; i >= 0; --i) {
      var c = cplist[i].parent;  // a component connected to ammeter terminal
      // look for a wire whose end points match those of the ammeter
      if (c.type == 'w') {
        var c_e1 = c.connections[0].location;
        var c_e2 = c.connections[1].location;
        if ((e1 == c_e1 && c2 == c_e2) || (e1 == c_e2 && e2 == c_e1)) {
          c.remove();
          break;
        }
      }
    }
  }

  Ammeter.prototype.draw = function (c) {
    this.draw_line(c, 0, 0, 16, 0);

    // draw chevron in probe color
    c.strokeStyle = probe_colors_rgb[this.properties['color']];
    if (c.strokeStyle != undefined) {
      c.beginPath();
      this.moveTo(c, 6, -3);
      this.lineTo(c, 10, 0);
      this.lineTo(c, 6, 3);
      c.stroke();
    }
  }

  Ammeter.prototype.clone = function (x, y) {
    return new Ammeter(x, y, this.rotation, this.properties['color'], this.properties['offset'],this.is_const);
  }

  // share code with voltage probe
  Ammeter.prototype.edit_properties = Probe.prototype.edit_properties;

  Ammeter.prototype.label = function () {
    var name = this.properties['name'];
    var label = 'I(' + (name ? name : '_' + this.properties['_json_']) + ')';
    return label;
  }

  // display current for DC analysis
  Ammeter.prototype.display_current = function (c, vmap) {
    var label = this.label();
    var v = vmap[label];
    if (v != undefined) {
      var i = engineering_notation(v, 2) + 'A';
      this.draw_text(c, i, 8, -5, 7, annotation_size, annotation_style);

      // only display each current once
      delete vmap[label];
    }
  }

  // return [color, current_label, offset, type] for this probe
  Ammeter.prototype.probe_info = function () {
    var color = this.properties['color'];
    var offset = this.properties['offset'];
    if (offset == undefined || offset == "") offset = '0';
    return [color, this.label(), offset, 'current'];
  }

  ////////////////////////////////////////////////////////////////////////////////
  //
  //  Resistor
  //
  ////////////////////////////////////////////////////////////////////////////////

  function Resistor(x, y, rotation, name, r,is_const) {
    Component.call(this, 'r', x, y, rotation);
    this.properties['name'] = name;
    this.properties['r'] = r ? r : '1';
    this.add_connection(0, 0);
    this.add_connection(0, 48);
    this.is_const=is_const;
    this.bounding_box = [-5, 0, 5, 48];
    this.update_coords();
  }


  Resistor.prototype = new Component();
  Resistor.prototype.constructor = Resistor;
  Resistor.prototype.randomize = function() {
    let min = 1 , max = 5320.4e3 ;
    let val = (Math.random() * (max -min + 1) + min );
   this.properties['r'] = val+"";

    //this.val = this.properties['r'] = (Math.random() * (max -min + 1) + min )+"";
  }

  Resistor.prototype.get_value = function(){
    return Number(this.properties['r']);
  }

  Resistor.prototype.toString = function () {
    return '<Resistor ' + this.properties['r'] + ' (' + this.x + ',' + this.y + ')>';
  }

  Resistor.prototype.draw = function (c) {
    Component.prototype.draw.call(this, c);   // give superclass a shot
    this.draw_line(c, 0, 0, 0, 12);
    this.draw_line(c, 0, 12, 4, 14);
    this.draw_line(c, 4, 14, -4, 18);
    this.draw_line(c, -4, 18, 4, 22);
    this.draw_line(c, 4, 22, -4, 26);
    this.draw_line(c, -4, 26, 4, 30);
    this.draw_line(c, 4, 30, -4, 34);
    this.draw_line(c, -4, 34, 0, 36);
    this.draw_line(c, 0, 36, 0, 48);
    if (!this.sch.is_static && this.properties['r']  )
      this.draw_text(c, this.properties['r'] + '\u03A9', 8, 24, 3, property_size);
    if (this.properties['name'])
      this.draw_text(c, this.properties['name'], -8, 24, 5, property_size);
  }

  Resistor.prototype.clone = function (x, y) {
    return new Resistor(x, y, this.rotation, this.properties['name'], this.properties['r'],this.is_const);
  }

  ////////////////////////////////////////////////////////////////////////////////
  //
  //  Capacitor
  //
  ////////////////////////////////////////////////////////////////////////////////

  function Capacitor(x, y, rotation, name, c,is_const) {
    Component.call(this, 'c', x, y, rotation);
    this.properties['name'] = name;
    this.is_const=is_const;
    this.properties['c'] = c ? c : '1e-12';
    this.add_connection(0, 0);
    this.add_connection(0, 48);
    this.bounding_box = [-8, 0, 8, 48];
    this.update_coords();
  }

  Capacitor.prototype = new Component();
  Capacitor.prototype.constructor = Capacitor;

  Capacitor.prototype.toString = function () {
    return '<Capacitor ' + this.properties['r'] + ' (' + this.x + ',' + this.y + ')>';
  }

   Capacitor.prototype.randomize = function() {
    let min = 1e-12 , max = 5320.4e-6 ;
      let val = (Math.random() * (max -min + 1) + min );
   this.properties['c'] = val+"";

 //   this.val = this.properties['c'] = (Math.random() * (max -min + 1) + min)+"p";
  }

  Capacitor.prototype.get_value = function(){
    return Number(this.properties['c']);
  }


  Capacitor.prototype.draw = function (c) {
    Component.prototype.draw.call(this, c);   // give superclass a shot
    this.draw_line(c, 0, 0, 0, 22);
    this.draw_line(c, -8, 22, 8, 22);
    this.draw_line(c, -8, 26, 8, 26);
    this.draw_line(c, 0, 26, 0, 48);
    if (!this.sch.is_static && this.properties['c'])
      this.draw_text(c, this.properties['c'] + 'F', 9, 24, 3, property_size);
    if (this.properties['name'])
      this.draw_text(c, this.properties['name'], -9, 24, 5, property_size);
  }

  Capacitor.prototype.clone = function (x, y) {
    return new Capacitor(x, y, this.rotation, this.properties['name'], this.properties['c'],this.is_const);
  }

  ////////////////////////////////////////////////////////////////////////////////
  //
  //  Inductor
  //
  ////////////////////////////////////////////////////////////////////////////////

  function Inductor(x, y, rotation, name, l,is_const) {
    Component.call(this, 'l', x, y, rotation);
    this.properties['name'] = name;
    this.is_const=is_const;
    this.properties['l'] = l ? l : '1e-9';
    this.add_connection(0, 0);
    this.add_connection(0, 48);
    this.bounding_box = [-4, 0, 5, 48];
    this.update_coords();
  }

  Inductor.prototype = new Component();
  Inductor.prototype.constructor = Inductor;

  Inductor.prototype.toString = function () {
    return '<Inductor ' + this.properties['l'] + ' (' + this.x + ',' + this.y + ')>';
  }

    Inductor.prototype.randomize = function() {
    let min = 1e-9  , max = 5320.4e-6;
    let val = (Math.random() * (max -min + 1) + min );
    this.properties['l'] = val+"";

 //   this.val = this.properties['l'] = (Math.random() * (max -min + 1) + min )+"n";
  }

  Inductor.prototype.get_value = function(){
    return Number(this.properties['l']);
  }


  Inductor.prototype.draw = function (c) {
    Component.prototype.draw.call(this, c);   // give superclass a shot
    this.draw_line(c, 0, 0, 0, 14);
    this.draw_arc(c, 0, 18, 4, 6 * Math.PI / 4, 3 * Math.PI / 4);
    this.draw_arc(c, 0, 24, 4, 5 * Math.PI / 4, 3 * Math.PI / 4);
    this.draw_arc(c, 0, 30, 4, 5 * Math.PI / 4, 2 * Math.PI / 4);
    this.draw_line(c, 0, 34, 0, 48);

    if (!this.sch.is_static &&  this.properties['l'])
      this.draw_text(c, this.properties['l'] + 'H', 8, 24, 3, property_size);
    if (this.properties['name'])
      this.draw_text(c, this.properties['name'], -6, 24, 5, property_size);
  }

  Inductor.prototype.clone = function (x, y) {
    return new Inductor(x, y, this.rotation, this.properties['name'], this.properties['l'],this.is_const);
  }

  ////////////////////////////////////////////////////////////////////////////////
  //
  //  Diode
  //
  ////////////////////////////////////////////////////////////////////////////////

  var diode_types = ['normal', 'ideal'];

  function Diode(x, y, rotation, name, area, type,is_const) {

    Component.call(this, 'd', x, y, rotation);
    this.is_const=is_const;
    this.properties['name'] = name;
    this.properties['area'] = area ? area : '1';
    this.properties['type'] = type ? type : 'normal';
    this.add_connection(0, 0);   // anode
    this.add_connection(0, 48);  // cathode
    this.bounding_box = (type == 'ideal') ? [-12, 0, 12, 48] : [-8, 0, 8, 48];
    this.update_coords();
  }


  Diode.prototype = new Component();
  Diode.prototype.constructor = Diode;

  Diode.prototype.toString = function () {
    return '<Diode ' + this.properties['area'] + ' (' + this.x + ',' + this.y + ')>';
  }

  Diode.prototype.randomize = function() {
    let min = 1 , max = 100 ;
      let val = (Math.random() * (max -min + 1) + min );
   this.properties['area'] = val+"";

  }
Diode.prototype.get_value = function(){
    return Number(this.properties['area']);
  }


  Diode.prototype.draw = function (c) {
    Component.prototype.draw.call(this, c);   // give superclass a shot
    this.draw_line(c, 0, 0, 0, 18);
    this.draw_line(c, -8, 18, 8, 18);
    this.draw_line(c, -8, 18, 0, 30);
    this.draw_line(c, 8, 18, 0, 30);
    this.draw_line(c, -8, 30, 8, 30);
    this.draw_line(c, 0, 30, 0, 48);

    if (this.properties['type'] == 'ideal') {
      // put a box around an ideal diode
      this.draw_line(c, -10, 12, 10, 12);
      this.draw_line(c, -10, 12, -10, 36);
      this.draw_line(c, 10, 12, 10, 36);
      this.draw_line(c, -10, 36, 10, 36);
    }

    if (!this.sch.is_static && this.properties['area'])
      this.draw_text(c, this.properties['area'], 10, 24, 3, property_size);
    if (this.properties['name'])
      this.draw_text(c, this.properties['name'], -10, 24, 5, property_size);
  }

  Diode.prototype.clone = function (x, y) {
    return new Diode(x, y, this.rotation, this.properties['name'], this.properties['area'], this.properties['type'],this.is_const);
  }

  Diode.prototype.edit_properties = function (x, y) {
    if (inside(this.bbox, x, y)) {
      var fields = [];
      fields['name'] = build_input('text', 10, this.properties['name']);
      fields['area'] = build_input('text', 10, this.properties['area']);
      fields['type'] = build_select(diode_types, this.properties['type']);

      var content = build_table(fields);
      content.fields = fields;
      content.component = this;

      this.sch.dialog(i18n.Edit_Properties, content, function (content) {
        content.component.properties['name'] = content.fields['name'].value;
        content.component.properties['area'] = content.fields['area'].value;
        content.component.properties['type'] = diode_types[content.fields['type'].selectedIndex];
        content.component.sch.redraw_background();
      });
      return true;
    } else return false;
  }

  ////////////////////////////////////////////////////////////////////////////////
  //
  //  N-channel Mosfet
  //
  ////////////////////////////////////////////////////////////////////////////////

  function NFet(x, y, rotation, name, w_over_l,is_const) {
    Component.call(this, 'n', x, y, rotation);
    this.properties['name'] = name;
    this.is_const=is_const;
    this.properties['WL'] = w_over_l ? w_over_l : '2';
    this.add_connection(0, 0);   // drain
    this.add_connection(-24, 24);  // gate
    this.add_connection(0, 48);  // source
    this.bounding_box = [-24, 0, 8, 48];
    this.update_coords();
  }



  NFet.prototype = new Component();
  NFet.prototype.constructor = NFet;

  NFet.prototype.toString = function () {
    return '<NFet ' + this.properties['WL'] + ' (' + this.x + ',' + this.y + ')>';
  }

  NFet.prototype.randomize = function() {
    let min = 1 , max = 100 ;
    val=  (Math.random() * (max -min + 1) + min );
    this.properties['WL'] = val+"";
  }

  NFet.prototype.get_value = function(){
    return Number(this.properties['WL']);
  }

  NFet.prototype.draw = function (c) {
    Component.prototype.draw.call(this, c);   // give superclass a shot
    this.draw_line(c, 0, 0, 0, 16);
    this.draw_line(c, -8, 16, 0, 16);
    this.draw_line(c, -8, 16, -8, 32);
    this.draw_line(c, -8, 32, 0, 32);
    this.draw_line(c, 0, 32, 0, 48);
    this.draw_line(c, -24, 24, -12, 24);
    this.draw_line(c, -12, 16, -12, 32);

    var dim = this.properties['WL'];
    if (this.properties['name']) {
      this.draw_text(c, this.properties['name'], 2, 22, 6, property_size);
      this.draw_text(c, dim, 2, 26, 0, property_size);
    } else
      this.draw_text(c, dim, 2, 24, 3, property_size);
  }

  NFet.prototype.clone = function (x, y) {
    return new NFet(x, y, this.rotation, this.properties['name'], this.properties['WL'],this.is_const);
  }

  ////////////////////////////////////////////////////////////////////////////////
  //
  //  P-channel Mosfet
  //
  ////////////////////////////////////////////////////////////////////////////////

  function PFet(x, y, rotation, name, w_over_l,is_const) {
    Component.call(this, 'p', x, y, rotation);
    this.is_const=is_const;
    this.properties['name'] = name;
    this.properties['WL'] = w_over_l ? w_over_l : '2';
    this.add_connection(0, 0);   // drain
    this.add_connection(-24, 24);  // gate
    this.add_connection(0, 48);  // source
    this.bounding_box = [-24, 0, 8, 48];
    this.update_coords();
  }


  PFet.prototype = new Component();
  PFet.prototype.constructor = PFet;

  PFet.prototype.randomize = function() {
    let min = 1 , max = 100 ;
   let val = (Math.random() * (max -min + 1) + min );
   this.properties['WL'] = val+"";
  }

  PFet.prototype.get_value = function(){
    return Number(this.properties['WL']);
  }

  PFet.prototype.toString = function () {
    return '<PFet ' + this.properties['WL'] + ' (' + this.x + ',' + this.y + ')>';
  }

  PFet.prototype.draw = function (c) {
    Component.prototype.draw.call(this, c);   // give superclass a shot
    this.draw_line(c, 0, 0, 0, 16);
    this.draw_line(c, -8, 16, 0, 16);
    this.draw_line(c, -8, 16, -8, 32);
    this.draw_line(c, -8, 32, 0, 32);
    this.draw_line(c, 0, 32, 0, 48);
    this.draw_line(c, -24, 24, -16, 24);
    this.draw_circle(c, -14, 24, 2, false);
    this.draw_line(c, -12, 16, -12, 32);

    var dim = this.properties['WL'];
    if (this.properties['name']) {
      this.draw_text(c, this.properties['name'], 2, 22, 6, property_size);
      this.draw_text(c, dim, 2, 26, 0, property_size);
    } else
      this.draw_text(c, dim, 2, 24, 3, property_size);
  }

  PFet.prototype.clone = function (x, y) {
    return new PFet(x, y, this.rotation, this.properties['name'], this.properties['WL'],this.is_const);
  }

  ////////////////////////////////////////////////////////////////////////////////
  //
  //  Op Amp
  //
  ////////////////////////////////////////////////////////////////////////////////

  function OpAmp(x, y, rotation, name, A,is_const) {
    Component.call(this, 'o', x, y, rotation);
    this.is_const=is_const;
    this.properties['name'] = name;
    this.properties['A'] = A ? A : '30000';
    this.add_connection(0, 0);   // +
    this.add_connection(0, 16);  // -
    this.add_connection(48, 8);  // output
    this.add_connection(24, 16);  // ground
    this.bounding_box = [0, -8, 48, 24];
    this.update_coords();
  }

  OpAmp.prototype = new Component();
  OpAmp.prototype.constructor = OpAmp;

  OpAmp.prototype.toString = function () {
    return '<OpAmp' + this.properties['A'] + ' (' + this.x + ',' + this.y + ')>';
  }

  OpAmp.prototype.draw = function (c) {
    Component.prototype.draw.call(this, c);   // give superclass a shot
    // triangle
    this.draw_line(c, 8, -8, 8, 24);
    this.draw_line(c, 8, -8, 32, 8);
    this.draw_line(c, 8, 24, 32, 8);
    // inputs and output
    this.draw_line(c, 0, 0, 8, 0);
    this.draw_line(c, 0, 16, 8, 16);
    //this.draw_text(c,'g',30,20,property_size);
    this.draw_line(c, 32, 8, 48, 8);
    this.draw_line(c, 24, 13, 24, 16);
    // + and -
    this.draw_line(c, 10, 0, 14, 0);
    this.draw_line(c, 12, -2, 12, 2);
    this.draw_line(c, 10, 16, 14, 16);

    if (this.properties['name'])
      this.draw_text(c, this.properties['name'], 24, -8, 0, property_size);
  }

  OpAmp.prototype.clone = function (x, y) {
    return new OpAmp(x, y, this.rotation, this.properties['name'], this.properties['A'],this.is_const);
  }

  ////////////////////////////////////////////////////////////////////////////////
  //
  //  Source
  //
  ////////////////////////////////////////////////////////////////////////////////

  function Source(x, y, rotation, name, type, value) {
    Component.call(this, type, x, y, rotation);
    this.properties['name'] = name;
    if (value == undefined) value = 'dc(1)';
    this.properties['value'] = value;
    this.add_connection(0, 0);
    this.add_connection(0, 48);
    this.bounding_box = [-12, 0, 12, 48];
    this.update_coords();
    this.content = document.createElement('div');  // used by edit_properties
  }


  Source.prototype = new Component();
  Source.prototype.constructor = Source;

  Source.prototype.toString = function () {
    return '<' + this.type + 'source ' + this.properties['params'] + ' (' + this.x + ',' + this.y + ')>';
  }

  Source.prototype.randomize = function() {
    let min = 0.5 , max = 25 ;
    let val = (Math.random() * (max -min + 1) + min );
    this.properties['value'] = 'dc('+val+")";
  }

  Source.prototype.get_value = function(){
    return Number(this.properties['value'].substring(3,this.properties['value'].length-1));
  }


  Source.prototype.draw = function (c) {
    Component.prototype.draw.call(this, c);   // give superclass a shot
    this.draw_line(c, 0, 0, 0, 12);
    this.draw_circle(c, 0, 24, 12, false);
    this.draw_line(c, 0, 36, 0, 48);

    if (this.type == 'v') {  // voltage source
      // draw + and -
      this.draw_line(c, 0, 15, 0, 21);
      this.draw_line(c, -3, 18, 3, 18);
      this.draw_line(c, -3, 30, 3, 30);
    } else if (this.type == 'i') {  // current source
      // draw arrow: pos to neg
      this.draw_line(c, 0, 15, 0, 32);
      this.draw_line(c, -3, 26, 0, 32);
      this.draw_line(c, 3, 26, 0, 32);
    }

    if (this.properties['name'])
      this.draw_text(c, this.properties['name'], -16, 24, 5, property_size);
    if (!this.sch.is_static && this.properties['value'])
      this.draw_text(c, this.properties['value'], 16, 24, 3, property_size);
  }

// map source function name to labels for each source parameter
  var source_functions = {
    'dc': ['DC_value'],

    'impulse': ['Height',
      'Width'],

    'step': ['Initial_value',
      'Plateau_value',
      'Delay_until_step',
      'Rise_time'],

    'square': ['Initial_value',
      'Plateau_value',
      'Frequency',
      'Duty_cycle'],

    'triangle': ['Initial_value',
      'Plateau_value',
      'Frequency'],

    'pwl': ['Comma_separated_list'],

    'pwl_repeating': ['Comma_separated_list'],

    'pulse': ['Initial_value',
      'Plateau_value',
      'Delay_until_pulse',
      'Time_for_first_transition',
      'Time_for_second_transition',
      'Pulse_width',
      'Period'],

    'sin': ['Offset_value',
      'Amplitude',
      'Frequency',
      'Delay_until_sin_starts',
      'Phase_offset_degrees']
  }

  // build property editor div
  Source.prototype.build_content = function (src) {
    // make an <input> widget for each property
    var fields = []
    fields['name'] = build_input('text', 10, this.properties['name']);

    if (src == undefined) {
      fields['value'] = this.properties['value'];
    } else {
      // fancy version: add select tag for source type
      var src_types = [];
      for (var t in source_functions) src_types.push(t);
      var type_select = build_select(src_types, src.fun);
      type_select.component = this;
      type_select.addEventListener('change', source_type_changed, false)
      fields['type'] = type_select;

      if (src.fun == 'pwl' || src.fun == 'pwl_repeating') {		//WMc fixed bug in original MIT code src.run
        var v = '';
        var first = true;
        for (var i = 0; i < src.args.length; i++) {
          if (first) first = false;
          else v += ',';
          v += engineering_notation(src.args[i], 3);
          if (i % 2 == 0) v += 's';
        }
        fields[source_functions[src.fun][0]] = build_input('text', 30, v);
      } else {
        // followed separate input tag for each parameter
        var labels = source_functions[src.fun];
        for (var i = 0; i < labels.length; i++) {
          var v = engineering_notation(src.args[i], 3);
          fields[labels[i]] = build_input('text', 10, v);
        }
      }
    }

    var div = this.content;
    if (div.hasChildNodes())
      div.removeChild(div.firstChild);  // remove table of input fields
    div.appendChild(build_table(fields));
    div.fields = fields;
    div.component = this;
    return div;
  }

  function source_type_changed(event) {
    if (!event) event = window.event;
    var select = event.target;

    // see where to get source parameters from
    var type = select.options[select.selectedIndex].value;
    var src = undefined;
    if (this.src != undefined && type == this.src.fun)
      src = this.src;
    else if (typeof cktsim != 'undefined')
      src = cktsim.parse_source(type + '()');

    select.component.build_content(src);
  }

  Source.prototype.edit_properties = function (x, y) {
    if (this.near(x, y)) {
      this.src = undefined;
      if (typeof cktsim != 'undefined')
        this.src = cktsim.parse_source(this.properties['value']);
      var content = this.build_content(this.src);

      this.sch.dialog(i18n.Edit_Properties, content, function (content) {
        var c = content.component;
        var fields = content.fields;

        var first = true;
        var value = '';
        for (var label in fields) {
          if (label == 'name')
            c.properties['name'] = fields['name'].value;
          else if (label == 'value') {
            // if unknown source type
            value = fields['value'].value;
            c.sch.redraw_background();
            return;
          } else if (label == 'type') {
            var select = fields['type'];
            value = select.options[select.selectedIndex].value + '(';
          } else {
            if (first) first = false;
            else value += ',';
            value += fields[label].value;
          }
        }
        c.properties['value'] = value + ')';
        c.sch.redraw_background();
      });
      return true;
    } else return false;
  }

  function VSource(x, y, rotation, name, value,is_const) {
    Source.call(this, x, y, rotation, name, 'v', value);
    this.is_const=is_const;
    this.type = 'v';
  }

 /* VSource.prototype.randomize = function() {
    let min = 0.1 , max = 25 ;
    this.properties['value'] = 'dc('+(Math.random() * (max -min + 1) + min )+")";
  } */


  VSource.prototype = new Component();
   VSource.prototype.randomize = function() {
    let min = 0.5 , max = 25 ;
    val =(Math.random() * (max -min + 1) + min );
      this.properties['value'] = 'dc('+val+")";
  }


  VSource.prototype.get_value = function(){
    return Number(this.properties['value'].substring(3,this.properties['value'].length-1));
  }

  VSource.prototype.constructor = VSource;
  VSource.prototype.toString = Source.prototype.toString;
  VSource.prototype.draw = Source.prototype.draw;
  VSource.prototype.clone = Source.prototype.clone;
  VSource.prototype.build_content = Source.prototype.build_content;
  VSource.prototype.edit_properties = Source.prototype.edit_properties;

  // display current for DC analysis
  VSource.prototype.display_current = function (c, vmap) {
    var name = this.properties['name'];
    var label = 'I(' + (name ? name : '_' + this.properties['_json_']) + ')';
    var v = vmap[label];
    if (v != undefined) {
      // first draw some solid blocks in the background
      c.globalAlpha = 0.5;
      this.draw_text(c, '\u2588\u2588\u2588', -8, 8, 4, annotation_size, element_style);
      c.globalAlpha = 1.0;

      // display the element current
      var i = engineering_notation(v, 2) + 'A';
      this.draw_text(c, i, -3, 5, 5, annotation_size, annotation_style);
      // draw arrow for current
      this.draw_line(c, -3, 4, 0, 8);
      this.draw_line(c, 3, 4, 0, 8);
      // only display each current once
      delete vmap[label];
    }
  }

  VSource.prototype.clone = function (x, y) {
    return new VSource(x, y, this.rotation, this.properties['name'], this.properties['value'],this.is_const);
  }

  function ISource(x, y, rotation, name, value,is_const) {
    Source.call(this, x, y, rotation, name, 'i', value);
    this.is_const = is_const;
    this.type = 'i';
  }

  ISource.prototype = new Component();
  ISource.prototype.constructor = ISource;
  ISource.prototype.randomize = function() {
    let min = 0.5 , max = 25 ;
    let val = (Math.random() * (max -min + 1) + min );
      this.properties['value'] = 'dc('+val+")";
  }

  ISource.prototype.get_value = function(){
    return Number(this.properties['value'].substring(3,this.properties['value'].length-1));
  }

  ISource.prototype.toString = Source.prototype.toString;
  ISource.prototype.draw = Source.prototype.draw;
  ISource.prototype.clone = Source.prototype.clone;
  ISource.prototype.build_content = Source.prototype.build_content;
  ISource.prototype.edit_properties = Source.prototype.edit_properties;

  ISource.prototype.clone = function (x, y) {
    return new ISource(x, y, this.rotation, this.properties['name'], this.properties['value'],this.is_const);
  }

  ///////////////////////////////////////////////////////////////////////////////
  //
  //  JQuery slider support for setting a component value
  //
  ///////////////////////////////////////////////////////////////////////////////

  function component_slider(event, ui) {
    var sname = $(this).slider("option", "schematic");

    // set value of specified component
    var cname = $(this).slider("option", "component");
    var pname = $(this).slider("option", "property");
    var suffix = $(this).slider("option", "suffix");
    if (typeof suffix != "string") suffix = "";

    var v = ui.value;
    $(this).slider("value", v);  // move slider's indicator

    var choices = $(this).slider("option", "choices");
    if (choices instanceof Array) v = choices[v];

    // selector may match several schematics
    $("." + sname).each(function (index, element) {
      element.schematic.set_property(cname, pname, v.toString() + suffix);
    })

    // perform requested analysis
    var analysis = $(this).slider("option", "analysis");
    if (analysis == "dc")
      $("." + sname).each(function (index, element) {
        element.schematic.dc_analysis();
      })

    return false;
  }

  function is_question_mouse_down(component) {

    console.log("here we are ");
    var json = './example.ntl';
    var reader = new FileReader();
    console.log(json);
    // print out the result when the file is finished loading
    reader.onload = function (e) {
      var imported_netlist = e.target.result;

      content.sch.components = [];
      content.sch.connection_points = [];
      //content.sch.load_schematic(imported_netlist);
      content.sch.zoomall();

      console.log(e.target.result);
    };

    // start reading the file
    reader.readAsText(json);


  }

  function is_question_double_click(component) {
    console.log(component.properties["name"]);
  }

  Schematic.prototype.printi = function () {
    console.log("hello this is printi");
  }

  ///////////////////////////////////////////////////////////////////////////////
  //
  //  Module definition
  //
  ///////////////////////////////////////////////////////////////////////////////

  Schematic.prototype.load_custom_tools = function (custom_parts)
  {
    this.custom_parts=custom_parts ;
    console.log(this.custom_parts.length);
    for (var i = 0; i < this.custom_parts.length; i++) {
        c = this.custom_parts[i];
          var type = c[0]
          var properties = c[1];
         // console.log(properties);

    /*      var part = new parts_map[type][0](coords[0], coords[1], coords[2]);
          for (var name in properties)
            part.properties[name] = properties[name];

          part.add(this);
      */var part = new Part(this);
      var pm = parts_map[type];
      part.set_component(new pm[0](0, 0,0, 0),"");
      part.component.is_const= true ;

      for (var name in properties)
            part.component.properties[name] = properties[name];
      part.tip =parts_map[type][1] + ' : '+part.component.properties['name']+' : '+ part.component.get_value() ;
      console.log(part.component);
      //part.component.properties= properties;
      this.parts_bin.push(part);
      if ( this.custom_table)
      {
     // console.log(this.custom_table);
      td = document.createElement('td');
      this.custom_table.appendChild(td);
        //tr.appendChild(td);
        td.appendChild(part.canvas);
      }
    }


  }

  Schematic.prototype.redraw_custom_parts = function ()
  {
    if (! this.custom_table) return ;
    while (this.custom_table.firstChild) {
    this.custom_table.removeChild(this.custom_table.firstChild);
    }
    for ( c of this.parts_bin )
    {
      if(c.component.is_const)
      {
        td = document.createElement('td');
      this.custom_table.appendChild(td);
        //tr.appendChild(td);
        td.appendChild(c.canvas);
      }
    }
  }

  Schematic.prototype.extract_vars = function (expression)
  {
    //let math = require('mathjs');
    let re = /([A-Za-z]+\d*)/g;
    let vars = [];
    while(s = re.exec(expression))
      vars.push(s[1]);
      return vars ;
  }

  Schematic.prototype.get_component = function(name)
  {
    for ( c in this.components)
    { //console.log(this.components[c]);
      if( this.components[c].properties['name']=== name)
        return this.components[c] ;
    }
  }

  Schematic.prototype.randomize = function()
  {
    for( c in this.components)
    { let d = this.components[c];
      // console.log(d instanceof Resistor );
      d.randomize();
    }
  }
  Schematic.prototype.parallel = function (expression)
  {  let exp= expression;
    let re=/((?:[A-Za-z]+\d*)|(?:\(.+\)))\/\/((?:[A-Za-z]+\d*)|(?:\(.+\)))/gy;
        let t=''
     while(t != exp) {
       t = exp;

       exp = exp.replace(re, '(($1*$2)/($1+$2))');

       console.log(exp) ;
        }
    return t;
  }

  get_closed_par = function(s,start)
  { d=-1;
    for ( i =start+1 ; i< s.length;i++)
    {
      if (s[i]==')')
        d++ ;
      if ( s[i] =='(')
        d-- ;
      if ( d== 0 )
        return i;
    }


  }

  Schematic.prototype.save_components = function()
  {
    //[["r" ,{"name":"rito","r":"1.5"}]]
    comps = [];
    for ( c of this.components)
    {
      if( c.selected)
      {
        let x = [c.type+""  ];
        let y ={};
        for(j in c.properties)
        {
          y[j+""] = c.properties[j]+"" ;
        }
        x.push(y);
        comps.push(x);
      }
    }
    return comps ;
  }


  Schematic.prototype.get_customparts = function () {
    //[["r" ,{"name":"rito","r":"1.5"}]]
    comps = [];
    for (d of this.parts_bin) { //console.log(d);
      let c = d.component;
      if (c.is_const) {

        let x = [c.type + ""];
        let y = {};
        for (j in c.properties) {
          y[j + ""] = c.properties[j] + "";
        }
        x.push(y);
        comps.push(x);
      }
    }
    return comps;
  }

  Schematic.prototype.get_labels = function () {
    comps = [];
    let l;
    for (c of this.components) {  //console.log(c);
      if (c.constructor == CLabel) {
        l = [c.properties['name'], c.properties['vales']];
        comps.push(l);

      }
    }
    return comps;
  }


  Schematic.prototype.remove_parts= function ()
  {
    for ( i in this.parts_bin)
    { c = this.parts_bin[i];
      if (c.component.is_const && c.selected)
        this.parts_bin.splice(i);

        console.log(c) ;
    }
    this.redraw_custom_parts();
  }
  var module = {
    'Schematic': Schematic,
    'component_slider': component_slider
  }
  return module;
}());
