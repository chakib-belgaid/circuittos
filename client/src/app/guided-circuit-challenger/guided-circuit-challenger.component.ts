import {Component, OnInit, ViewChild} from '@angular/core';
import {CircuitsService} from '../circuits.service';
import {ActivatedRoute, ParamMap} from '@angular/router';

@Component({
  selector: 'app-guided-circuit-challenger',
  templateUrl: './guided-circuit-challenger.component.html',
  styleUrls: ['./guided-circuit-challenger.component.css']
})
export class GuidedCircuitChallengerComponent implements OnInit {
  @ViewChild('circuit') input;
  circuit: any;
  lvl = '';

  constructor(private circuitService: CircuitsService
    , private route: ActivatedRoute,) {
  }

  ngOnInit() {
    this.circuit = new schematic.Schema(this.input.nativeElement);
    this.circuit.allow_edits = false;
    this.circuit.is_static = true;
    this.route.paramMap.subscribe((params: ParamMap) => {
      this.lvl = params.get('id');
    });

    this.circuitService.load_guidedlevel(this.lvl).then(value => {
      const level = value.circuit;
      this.circuit.load_custom_tools(JSON.parse(value.parts));
      console.log(value);
      this.circuit.update_schematic1();
      this.circuit.load_schematic(level);

    });
  }

  calculate() {
    this.circuit.dc_analysis();
    const y = this.circuit.dc_results;
    console.log(y);
  }
}
