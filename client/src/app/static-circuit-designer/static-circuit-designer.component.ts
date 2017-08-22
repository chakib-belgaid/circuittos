import {Component, OnInit, ViewChild} from '@angular/core';
import {CircuitsService} from "../circuits.service";


@Component({
  selector: 'app-static-circuit-designer',
  templateUrl: './static-circuit-designer.component.html',
  styleUrls: ['./static-circuit-designer.component.css']
})
export class StaticCircuitDesignerComponent implements OnInit {
@ViewChild('circuit') input ;
circuit: any ;
constructor(
  private circuitService : CircuitsService ) {}

  ngOnInit() {
      this.circuit = new schematic.Schematic(this.input.nativeElement);
      this.circuit.allow_edits = true ;
      this.circuit.parts= ['g','r','v','i','c','l','a','s','n'];
      this.circuit.is_static = true ;
      this.circuit.analyses.push('dc','ac','tran');
      this.circuit.update_schematic1();
      //this.circuit.extract_vars('R1*R2-R3+5i/c2');
  }

  save_circuit() {
    let schema = this.circuit.json();
    this.circuitService.save_circuit({circuit:JSON.stringify(schema)});

  }
}
