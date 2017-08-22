import {Component, OnInit, ViewChild} from '@angular/core';


@Component({
  selector: 'app-static-circuit-designer',
  templateUrl: './static-circuit-designer.component.html',
  styleUrls: ['./static-circuit-designer.component.css']
})
export class StaticCircuitDesignerComponent implements OnInit {
@ViewChild('circuit') input ;
circuit: any ;
constructor() { }

  ngOnInit() {
      this.circuit = new schematic.Schematic(this.input.nativeElement);
      this.circuit.allow_edits = true ;
      this.circuit.parts= ['g','l','v','i','c','l','a','s','n'];
      this.circuit.is_static = true ;
      this.circuit.update_schematic1();
  }

}
