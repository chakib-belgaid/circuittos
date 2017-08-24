import {Component, OnInit, ViewChild} from '@angular/core';
import {ActivatedRoute, ParamMap} from "@angular/router";
import {CircuitsService} from "../circuits.service";

@Component({
  selector: 'app-guided-circuit-designer',
  templateUrl: './guided-circuit-designer.component.html',
  styleUrls: ['./guided-circuit-designer.component.css']
})
export class GuidedCircuitDesignerComponent implements OnInit {
@ViewChild('circuit') input ;
@ViewChild('my_components') my_table;
circuit: any ;
  constructor( private circuitService : CircuitsService ,
 private route: ActivatedRoute, ) { }

 ngOnInit() {
      this.circuit = new schematic.Schematic(this.input.nativeElement);
      this.circuit.allow_edits = true ;
      this.circuit.parts= ['t','L','g','r','v','i','c','l','a','s','n'];
      //this.circuit.is_static = true ;
      this.circuit.analyses.push('dc','ac','tran');
      this.circuit.update_schematic1();
       this.route.paramMap.subscribe((params: ParamMap) =>{
       let x =  params.get('id');
       if(x)
       {
        this.circuitService.getCircuit(x ).then(value => {
       const level = value.circuit;
      // console.log(value);
          //his.circuit.update_schematic1();
           this.circuit.load_schematic(level) ;

     });
}
      });
      //this.circuit.extract_vars('R1*R2-R3+5i/c2');
  }

  save_circuit() {
    let schema = this.circuit.json();
    this.circuitService.save_circuit({circuit:JSON.stringify(schema)});

  }

  add_component() {
    this.circuit.custom_table = this.my_table.nativeElement;
    //console.log(this.my_table) ;
    let d = this.circuit.save_components();
    this.circuit.load_custom_tools(d);
    //this.circuit.update_schematic1() ;
  }

  remove_component() {
      this.circuit.remove_parts();
  }

  save_level() {

  }
}
